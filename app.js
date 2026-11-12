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

  function setBookingProfile(profile) {
    var name = document.getElementById("booking-name");
    var contact = document.getElementById("booking-contact");
    if (!name || !contact) return;
    if (!profile) {
      name.textContent = "Sign in through the Student portal before requesting an appointment.";
      contact.textContent = "Update your name and contact details in My profile if needed.";
      return;
    }
    name.textContent = profile.full_name || "Name not set";
    contact.textContent = profile.phone
      ? "Phone on file: " + profile.phone
      : "No phone number is on file. Update My profile if the clinic needs to call.";
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
      if (page === "booking") setBookingProfile(null);
      if (isPortalPage) setSignedInState(false);
      if (isPortalPage) adminPanel.hidden = true;
      guardCurrentPage();
      return;
    }

    if (!isPortalPage) {
      if (page === "booking") {
        var bookingProfileResult = await client
          .from("profiles")
          .select("full_name, phone")
          .eq("id", session.user.id)
          .single();
        if (bookingProfileResult.error) throw bookingProfileResult.error;
        setBookingProfile(bookingProfileResult.data);
      }
      return;
    }
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
        var intake = document.createElement("details");
        intake.className = "intake-details";
        intake.appendChild(element("summary", "View private intake details"));
        var intakeList = document.createElement("dl");
        var appendIntakeField = function (label, value) {
          intakeList.appendChild(element("dt", label));
          intakeList.appendChild(element("dd", value || "Not provided"));
        };
        var symptomLabels = {
          fever: "Fever",
          cough: "Cough",
          colds: "Colds",
          headache: "Headache",
          severe_chest_pain: "Severe chest pain",
          heavy_bleeding: "Heavy bleeding",
          seizures: "Seizures",
          sudden_weakness: "Sudden weakness",
          stomach_pain: "Stomach pain",
          difficulty_breathing: "Difficulty breathing",
          body_aches: "Body aches",
          dizziness: "Dizziness",
          other: "Other",
        };
        var conditionLabels = {
          hypertension: "Hypertension",
          diabetes: "Diabetes",
          asthma: "Asthma",
          heart_disease: "Heart disease",
          kidney_disease: "Kidney disease",
          tb: "TB",
          none: "None",
          other: "Other",
        };
        var needLabels = {
          wheelchair: "Wheelchair access",
          mobility_assistance: "Help getting around",
          seating_assistance: "Help sitting or standing",
          pwd: "PWD assistance",
          senior: "Senior assistance",
          other: "Other",
          none: "No assistance needed",
        };
        var valueLabel = function (value, labels) {
          return labels[value] || value || "Not provided";
        };
        appendIntakeField("Reason for visit", row.visit_reason);
        appendIntakeField("Symptoms", (row.symptoms || []).map(function (value) {
          return valueLabel(value, symptomLabels);
        }).join(", "));
        appendIntakeField("Symptom duration", valueLabel(row.symptom_duration, {
          today: "Today",
          "1_3_days": "1–3 days",
          more_than_week: "More than a week",
          more_than_month: "More than a month",
        }));
        appendIntakeField("Additional symptom notes", row.symptom_notes);
        appendIntakeField("Past conditions", (row.medical_conditions || []).map(function (value) {
          return valueLabel(value, conditionLabels);
        }).join(", "));
        appendIntakeField("Condition notes", row.condition_notes);
        appendIntakeField("Medicines", row.medications);
        appendIntakeField("Allergies", row.allergies);
        appendIntakeField("Pregnancy", valueLabel(row.pregnancy_status, {
          yes: "Yes",
          no: "No",
          unsure: "Not sure",
          prefer_not_to_say: "Prefer not to say",
        }));
        appendIntakeField("Wellbeing", valueLabel(row.wellbeing, {
          good: "Good",
          a_bit_heavy: "A bit heavy",
          sad_or_anxious: "I often feel sad or anxious",
          prefer_to_talk: "I would rather talk to the doctor",
        }));
        appendIntakeField("Access needs", (row.accessibility_needs || []).map(function (value) {
          return valueLabel(value, needLabels);
        }).join(", "));
        appendIntakeField("Access notes", row.accessibility_notes);
        appendIntakeField("Confirmation preference", valueLabel(row.contact_preference, {
          no_preference: "No preference",
          call: "Call",
          text: "Text message",
        }));
        appendIntakeField("Privacy consent", row.privacy_consent_at
          ? "Recorded " + new Date(row.privacy_consent_at).toLocaleString()
          : "Not recorded");
        intake.appendChild(intakeList);
        item.appendChild(intake);

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
      .select("id, student_id, service, appointment_date, time_slot, status, created_at, visit_reason, symptoms, symptom_duration, symptom_notes, medical_conditions, condition_notes, medications, allergies, pregnancy_status, wellbeing, accessibility_needs, accessibility_notes, contact_preference, privacy_consent_at, profiles(student_code, full_name, email)")
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

  var bookingForm = document.getElementById("book-form");
  var bookingSteps = Array.prototype.slice.call(bookingForm.querySelectorAll("[data-booking-step]"));
  var bookingProgressItems = Array.prototype.slice.call(
    bookingForm.querySelectorAll(".booking-steps li")
  );
  var bookingStepNames = ["Visit details", "Reason and symptoms", "Health and consent"];
  var bookingStep = 1;
  var bookingResult = document.getElementById("result");
  var bookingBack = document.getElementById("booking-back");
  var bookingNext = document.getElementById("booking-next");
  var bookingSubmit = document.getElementById("booking-submit");

  function showBookingResult(message, isError) {
    bookingResult.textContent = message;
    bookingResult.hidden = false;
    bookingResult.classList.toggle("error", Boolean(isError));
  }

  function setBookingStep(nextStep, moveFocus) {
    bookingStep = nextStep;
    bookingSteps.forEach(function (stepPanel) {
      stepPanel.hidden = Number(stepPanel.getAttribute("data-booking-step")) !== bookingStep;
    });
    bookingProgressItems.forEach(function (item, index) {
      if (index + 1 === bookingStep) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
      if (index + 1 < bookingStep) item.setAttribute("data-complete", "true");
      else item.removeAttribute("data-complete");
    });
    document.getElementById("booking-step-label").textContent =
      "Step " + bookingStep + " of " + bookingSteps.length + ": " + bookingStepNames[bookingStep - 1];
    bookingBack.hidden = bookingStep === 1;
    bookingNext.hidden = bookingStep === bookingSteps.length;
    bookingSubmit.hidden = bookingStep !== bookingSteps.length;
    bookingResult.hidden = true;
    bookingResult.textContent = "";
    bookingResult.classList.remove("error");
    if (moveFocus) bookingSteps[bookingStep - 1].querySelector("h3").focus();
  }

  function validateBookingStep(step) {
    var controls = bookingSteps[step - 1].querySelectorAll("input, select, textarea");
    for (var index = 0; index < controls.length; index++) {
      if (!controls[index].checkValidity()) {
        controls[index].reportValidity();
        controls[index].focus();
        return false;
      }
    }
    return true;
  }

  function checkedValues(name) {
    return Array.prototype.map.call(
      bookingForm.querySelectorAll('input[name="' + name + '"]:checked'),
      function (input) { return input.value; }
    );
  }

  function checkedRadioValue(name) {
    var selected = bookingForm.querySelector('input[name="' + name + '"]:checked');
    return selected ? selected.value : null;
  }

  bookingForm.querySelectorAll("[data-exclusive-group]").forEach(function (input) {
    input.addEventListener("change", function () {
      if (!input.checked) return;
      var groupName = input.getAttribute("data-exclusive-group");
      var group = bookingForm.querySelectorAll(
        'input[data-exclusive-group="' + groupName + '"]'
      );
      if (input.getAttribute("data-exclusive-value") === "none") {
        group.forEach(function (option) {
          if (option !== input) option.checked = false;
        });
      } else {
        group.forEach(function (option) {
          if (option.getAttribute("data-exclusive-value") === "none") option.checked = false;
        });
      }
    });
  });

  bookingNext.addEventListener("click", function () {
    if (!validateBookingStep(bookingStep)) return;
    setBookingStep(Math.min(bookingStep + 1, bookingSteps.length), true);
  });

  bookingBack.addEventListener("click", function () {
    setBookingStep(Math.max(bookingStep - 1, 1), true);
  });

  bookingForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    var date = document.getElementById("f-date").value;

    if (!session) {
      showBookingResult("Sign in through the student portal before requesting an appointment.", true);
      return;
    }
    if (bookingStep !== bookingSteps.length) {
      showBookingResult("Complete the previous steps before submitting your request.", true);
      return;
    }
    if (!validateBookingStep(bookingStep)) return;

    var symptoms = checkedValues("symptoms");
    if ([
      "difficulty_breathing",
      "severe_chest_pain",
      "heavy_bleeding",
      "seizures",
      "sudden_weakness",
    ].some(function (symptom) { return symptoms.indexOf(symptom) >= 0; })) {
      showBookingResult(
        "These symptoms need urgent care. Do not book online; go to the ER right away or call 123-111-3243.",
        true
      );
      bookingResult.focus();
      return;
    }

    var day = new Date(date + "T00:00:00").getDay();
    var timeSlot = document.getElementById("f-time").value;
    if (day === 0) {
      showBookingResult("The clinic is closed on Sundays. Choose a date from Monday to Saturday.", true);
      return;
    }
    if (day === 6 && timeSlot === "afternoon") {
      showBookingResult("Saturday hours end at 12:00 PM. Choose the morning slot.", true);
      return;
    }

    var insertResult = await client.from("appointments").insert({
      student_id: session.user.id,
      service: document.getElementById("f-service").value,
      appointment_date: date,
      time_slot: timeSlot,
      visit_reason: document.getElementById("f-reason").value.trim(),
      symptoms: symptoms,
      symptom_duration: document.getElementById("f-duration").value || null,
      symptom_notes: document.getElementById("f-symptom-notes").value.trim() || null,
      medical_conditions: checkedValues("medical_conditions"),
      condition_notes: document.getElementById("f-condition-notes").value.trim() || null,
      medications: document.getElementById("f-medications").value.trim() || null,
      allergies: document.getElementById("f-allergies").value.trim() || null,
      pregnancy_status: checkedRadioValue("pregnancy_status"),
      wellbeing: checkedRadioValue("wellbeing"),
      accessibility_needs: checkedValues("accessibility_needs"),
      accessibility_notes: document.getElementById("f-accessibility-notes").value.trim() || null,
      contact_preference: document.getElementById("f-contact-preference").value,
      privacy_consent: document.getElementById("f-privacy-consent").checked,
    });
    if (insertResult.error) {
      showBookingResult("Unable to submit the appointment: " + insertResult.error.message, true);
      return;
    }
    bookingForm.reset();
    setBookingStep(1, false);
    showBookingResult("Appointment request submitted. The clinic will review it.", false);
    await loadStudentAppointments();
  });

  loadAccount().catch(function (error) {
    if (window.CP3BPage && window.CP3BPage.name === "booking") {
      showBookingResult(
        "Unable to load your profile details: " + (error.message || "Please try again."),
        true
      );
      return;
    }
    showStatus(portalStatus, error.message || "Unable to connect to the student portal.", true);
  });
})();
