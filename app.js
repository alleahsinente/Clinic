(function () {
  "use strict";

  var SUPABASE_URL = "https://zsiyprpyeixkathjlhih.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5S1E1_A68gvwCWK8XBuHUg_iowSxaCA";
  var SIGN_IN_FUNCTION = SUPABASE_URL + "/functions/v1/sign-in-by-student-code";
  var CODE_PATTERN = /^CCD-\d{4}-\d{5}$/;
  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  var session = null;
  var adminChannel = null;

  var authPanel = document.getElementById("auth-panel");
  var accountPanel = document.getElementById("account-panel");
  var adminPanel = document.getElementById("admin-panel");
  var portalStatus = document.getElementById("portal-status");

  function showStatus(element, message, isError) {
    element.textContent = message;
    element.hidden = false;
    element.classList.toggle("error", Boolean(isError));
  }

  function clearStatus(element) {
    element.textContent = "";
    element.hidden = true;
    element.classList.remove("error");
  }

  function readForm(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function requireCode(value) {
    var code = String(value || "").trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new Error("Use the student ID format CCD-YYYY-00000.");
    }
    return code;
  }

  function element(tag, text) {
    var node = document.createElement(tag);
    node.textContent = text == null ? "" : String(text);
    return node;
  }

  function setSignedInState(signedIn) {
    authPanel.hidden = signedIn;
    accountPanel.hidden = !signedIn;
  }

  function guardCurrentPage() {
    if (!window.CP3BPage) return true;
    var page = window.CP3BPage.name;
    var accountPages = ["profile", "student-appointments"];
    var adminPages = [
      "admin-dashboard", "approve-student", "student-directory", "admin-appointments"
    ];
    var authPages = ["portal-signin", "portal-register"];

    if (accountPages.indexOf(page) >= 0 && !session) {
      window.location.replace(window.CP3BPage.urlFor("portal-signin"));
      return false;
    }
    if (adminPages.indexOf(page) >= 0 && !session) {
      window.location.replace(window.CP3BPage.urlFor("portal-signin"));
      return false;
    }
    if (adminPages.indexOf(page) >= 0 && adminPanel.hidden) {
      window.location.replace(window.CP3BPage.urlFor("profile"));
      return false;
    }
    if (authPages.indexOf(page) >= 0 && session) {
      window.location.replace(window.CP3BPage.urlFor(adminPanel.hidden ? "profile" : "admin-dashboard"));
      return false;
    }
    return true;
  }

  async function loadAccount() {
    var page = window.CP3BPage ? window.CP3BPage.name : "";
    var portalPages = [
      "portal-signin", "portal-register", "profile", "student-appointments",
      "admin-dashboard", "approve-student", "student-directory", "admin-appointments"
    ];
    var isPortalPage = portalPages.indexOf(page) >= 0;
    if (!isPortalPage && page !== "booking") return;

    var authResult = await client.auth.getSession();
    if (authResult.error) throw authResult.error;
    session = authResult.data.session;
    if (!session) {
      if (isPortalPage) setSignedInState(false);
      if (isPortalPage) adminPanel.hidden = true;
      guardCurrentPage();
      return;
    }

    if (!isPortalPage) return;
    setSignedInState(true);
    var profileResult = await client
      .from("profiles")
      .select("id, student_code, email, full_name, course, section, phone")
      .eq("id", session.user.id)
      .single();
    if (profileResult.error) throw profileResult.error;

    var roleResult = await client
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (roleResult.error) throw roleResult.error;

    adminPanel.hidden = !roleResult.data || roleResult.data.role !== "admin";
    if (!guardCurrentPage()) return;
    document.getElementById("account-code").textContent = profileResult.data.student_code;
    document.getElementById("account-email").textContent = profileResult.data.email;
    document.getElementById("profile-name").value = profileResult.data.full_name || "";
    document.getElementById("profile-course").value = profileResult.data.course || "";
    document.getElementById("profile-section").value = profileResult.data.section || "";
    document.getElementById("profile-phone").value = profileResult.data.phone || "";

    await loadStudentAppointments();
    if (!adminPanel.hidden) {
      await loadAdminDashboard();
      subscribeAdminRealtime();
    }
    clearStatus(portalStatus);
  }

  async function loadStudentAppointments() {
    var result = await client
      .from("appointments")
      .select("id, service, appointment_date, time_slot, status, created_at")
      .eq("student_id", session.user.id)
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    renderAppointments(document.getElementById("student-appointments"), result.data, false);
  }

  function renderAppointments(container, rows, includeStudent) {
    container.replaceChildren();
    if (!rows.length) {
      container.appendChild(element("p", "No appointment requests yet."));
      return;
    }

    rows.forEach(function (row) {
      var item = element("article");
      item.className = "portal-row";
      var title = row.service + " · " + row.appointment_date + " · " +
        (row.time_slot === "morning" ? "Morning" : "Afternoon");
      item.appendChild(element("strong", title));
      item.appendChild(element("span", "Status: " + row.status));
      if (includeStudent && row.profiles) {
        item.appendChild(element("span", row.profiles.student_code + " · " + row.profiles.full_name));
        item.appendChild(element("span", row.profiles.email));
      }
      if (includeStudent) {
        var select = document.createElement("select");
        select.setAttribute("aria-label", "Appointment status");
        ["pending", "confirmed", "cancelled", "completed"].forEach(function (status) {
          var option = element("option", status);
          option.value = status;
          option.selected = status === row.status;
          select.appendChild(option);
        });
        var save = element("button", "Update status");
        save.className = "btn ghost";
        save.type = "button";
        save.addEventListener("click", async function () {
          save.disabled = true;
          var updateResult = await client.from("appointments")
            .update({ status: select.value })
            .eq("id", row.id);
          save.disabled = false;
          if (updateResult.error) {
            showStatus(portalStatus, updateResult.error.message, true);
            return;
          }
          showStatus(portalStatus, "Appointment status updated.", false);
          await loadAdminDashboard();
        });
        item.appendChild(select);
        item.appendChild(save);
      }
      container.appendChild(item);
    });
  }

  async function loadAdminDashboard() {
    var profilesResult = await client
      .from("profiles")
      .select("student_code, email, full_name, course, section, phone")
      .order("student_code");
    if (profilesResult.error) throw profilesResult.error;

    var appointmentsResult = await client
      .from("appointments")
      .select("id, student_id, service, appointment_date, time_slot, status, created_at, profiles(student_code, full_name, email)")
      .order("created_at", { ascending: false });
    if (appointmentsResult.error) throw appointmentsResult.error;

    document.getElementById("student-count").textContent = String(profilesResult.data.length);
    document.getElementById("appointment-count").textContent = String(appointmentsResult.data.length);
    renderStudentDirectory(profilesResult.data);
    renderAppointments(
      document.getElementById("admin-appointments"),
      appointmentsResult.data,
      true
    );
  }

  function renderStudentDirectory(rows) {
    var body = document.getElementById("student-directory");
    body.replaceChildren();
    rows.forEach(function (profile) {
      var row = document.createElement("tr");
      [
        profile.student_code,
        profile.full_name,
        profile.email,
        profile.course || "—",
        profile.section || "—",
        profile.phone || "—",
      ].forEach(function (value) {
        row.appendChild(element("td", value));
      });
      body.appendChild(row);
    });
  }

  function subscribeAdminRealtime() {
    if (adminChannel) {
      client.removeChannel(adminChannel);
    }
    adminChannel = client.channel("student-portal-admin")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "appointments",
      }, function () {
        loadAdminDashboard().catch(function (error) {
          showStatus(portalStatus, error.message, true);
        });
        loadStudentAppointments().catch(function (error) {
          showStatus(portalStatus, error.message, true);
        });
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "profiles",
      }, function () {
        loadAdminDashboard().catch(function (error) {
          showStatus(portalStatus, error.message, true);
        });
      })
      .subscribe(function (status) {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          showStatus(portalStatus, "Live updates are unavailable. Reload the dashboard to refresh.", true);
        }
      });
  }

  document.getElementById("signin-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    clearStatus(portalStatus);
    var form = event.currentTarget;
    var values = readForm(form);
    try {
      var studentCode = requireCode(values.student_code);
      var response = await fetch(SIGN_IN_FUNCTION, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ student_code: studentCode, password: values.password }),
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to sign in.");
      var sessionResult = await client.auth.setSession(result.session);
      if (sessionResult.error) throw sessionResult.error;
      form.reset();
      await loadAccount();
    } catch (error) {
      showStatus(portalStatus, error.message || "Unable to sign in.", true);
    }
  });

  document.getElementById("signup-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    clearStatus(portalStatus);
    var form = event.currentTarget;
    var values = readForm(form);
    try {
      var studentCode = requireCode(values.student_code);
      if (String(values.password).length < 8) {
        throw new Error("Choose a password with at least 8 characters.");
      }
      var result = await client.auth.signUp({
        email: String(values.email).trim().toLowerCase(),
        password: values.password,
        options: {
          data: {
            student_code: studentCode,
            full_name: String(values.full_name).trim(),
          },
        },
      });
      if (result.error) throw result.error;
      form.reset();
      showStatus(
        portalStatus,
        "Check your email to confirm the account. Registration requires a matching, active student-roster entry.",
        false
      );
    } catch (error) {
      var message = error.message || "Unable to create the account.";
      if (/database error saving new user/i.test(message)) {
        message =
          "We couldn't create your account. Make sure your student ID and email match an active student-roster entry. If you already registered, sign in instead; otherwise ask an administrator to verify your roster entry.";
      }
      showStatus(portalStatus, message, true);
    }
  });

  document.getElementById("signout-button").addEventListener("click", async function () {
    var result = await client.auth.signOut();
    if (result.error) {
      showStatus(portalStatus, result.error.message, true);
      return;
    }
    session = null;
    if (adminChannel) {
      await client.removeChannel(adminChannel);
      adminChannel = null;
    }
    window.location.replace(window.CP3BPage
      ? window.CP3BPage.urlFor("portal-signin")
      : "?page=portal-signin");
  });

  document.getElementById("profile-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var values = readForm(event.currentTarget);
    var result = await client.from("profiles").update({
      full_name: String(values.full_name).trim(),
      course: String(values.course).trim() || null,
      section: String(values.section).trim() || null,
      phone: String(values.phone).trim() || null,
    }).eq("id", session.user.id);
    if (result.error) {
      showStatus(portalStatus, result.error.message, true);
      return;
    }
    showStatus(portalStatus, "Profile saved.", false);
    if (!adminPanel.hidden) await loadAdminDashboard();
  });

  document.getElementById("roster-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var values = readForm(form);
    try {
      var studentCode = requireCode(values.student_code);
      var result = await client.from("student_roster").insert({
        student_code: studentCode,
        email: String(values.email).trim().toLowerCase(),
        full_name: String(values.full_name).trim() || null,
        course: String(values.course).trim() || null,
        section: String(values.section).trim() || null,
      });
      if (result.error) throw result.error;
      form.reset();
      showStatus(portalStatus, "Student added to the approved roster. They can now register with the matching email and ID.", false);
    } catch (error) {
      showStatus(portalStatus, error.message || "Unable to add student to the roster.", true);
    }
  });

  document.getElementById("book-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var date = document.getElementById("f-date").value;
    var resultNode = document.getElementById("result");
    resultNode.hidden = false;

    if (!session) {
      resultNode.textContent = "Sign in through the student portal before requesting an appointment.";
      return;
    }
    if (!date) {
      resultNode.textContent = "Choose a preferred date to continue.";
      return;
    }
    var day = new Date(date + "T00:00:00").getDay();
    var timeLabel = document.getElementById("f-time").value;
    if (day === 0) {
      resultNode.textContent = "The clinic is closed on Sundays. Choose a date from Monday to Saturday.";
      return;
    }
    if (day === 6 && timeLabel.indexOf("Afternoon") === 0) {
      resultNode.textContent = "Saturday hours end at 12:00 PM. Choose the morning slot.";
      return;
    }

    var insertResult = await client.from("appointments").insert({
      student_id: session.user.id,
      service: document.getElementById("f-service").value,
      appointment_date: date,
      time_slot: timeLabel.indexOf("Afternoon") === 0 ? "afternoon" : "morning",
    });
    if (insertResult.error) {
      resultNode.textContent = insertResult.error.message;
      return;
    }
    resultNode.textContent = "Appointment request submitted. The clinic will review it.";
    await loadStudentAppointments();
  });

  loadAccount().catch(function (error) {
    showStatus(portalStatus, error.message || "Unable to connect to the student portal.", true);
  });
})();
