/* The shared Supabase client and the session helpers live in auth.js, which
   every page loads before this file, so the project has only one client. */

let burialRecords = [];
let editingRecordId = null;

/* Set by insertBurialRecord / updateBurialRecord so the caller can show a
   message that explains what actually went wrong (for example a duplicate
   block + plot rejected by the unique constraint). */
let lastRecordSaveMessage = "";

async function getBurialRecordsFromSupabase() {
    if (!supabaseClient) {
        return null;
    }

    const { data, error } = await supabaseClient
        .from("burial_records")
        .select("*")
        .order("id");

    if (error) {
        console.warn("Unable to load burial records from Supabase:", error.message);
        return null;
    }

    return Array.isArray(data) ? data : null;
}

async function insertBurialRecord(record) {
    if (!supabaseClient) {
        return null;
    }

    const { data, error } = await supabaseClient
        .from("burial_records")
        .insert(record)
        .select()
        .single();

    if (error) {
        console.warn("Unable to insert the burial record:", error.message);
        lastRecordSaveMessage = error.code === "23505"
            ? "That block and plot already exist. Use a different plot number."
            : "The record could not be saved. Check your connection and try again.";
        return null;
    }

    return data;
}

async function updateBurialRecord(record) {
    if (!supabaseClient || !record?.id) {
        return null;
    }

    const { id, ...changes } = record;

    const { data, error } = await supabaseClient
        .from("burial_records")
        .update(changes)
        .eq("id", id)
        .select()
        .single();

    if (error) {
        console.warn("Unable to update the burial record:", error.message);
        lastRecordSaveMessage = error.code === "23505"
            ? "That block and plot already exist. Use a different plot number."
            : "The record could not be saved. Check your connection and try again.";
        return null;
    }

    return data;
}

async function deleteReservationApplicationForRecord(recordId) {
    if (!supabaseClient || !recordId) {
        return true;
    }

    const { error } = await supabaseClient
        .from("reservation_applications")
        .delete()
        .eq("record_id", recordId);

    if (error) {
        console.warn("Unable to delete the reservation application:", error.message);
        return false;
    }

    reservationApplications = reservationApplications.filter((item) => item.recordId !== recordId);
    return true;
}

async function deleteBurialRecordFromSupabase(recordId) {
    if (!supabaseClient) {
        return false;
    }

    // the application is not linked by a foreign key, so remove it explicitly
    if (!await deleteReservationApplicationForRecord(recordId)) {
        return false;
    }

    const { error } = await supabaseClient
        .from("burial_records")
        .delete()
        .eq("id", recordId);

    if (error) {
        console.warn("Unable to delete burial record from Supabase:", error.message);
        return false;
    }

    return true;
}

async function loadBurialRecords() {
    try {
        const supabaseRecords = await getBurialRecordsFromSupabase();
        if (Array.isArray(supabaseRecords)) {
            return supabaseRecords;
        }
    } catch (error) {
        console.warn("Unable to load burial records:", error);
    }

    return [];
}

const MAX_RECENT_ITEMS = 5;

/* ---- lease renewal reminders (see supabase/04_lease_reminders.sql) ---- */
const LEASE_DUE_SOON_DAYS = 30;   // 30 days or fewer left -> "Due Soon"
const LEASE_URGENT_DAYS   = 7;    //  7 days or fewer left -> "Urgent Renewal"

const LEASE_REMINDER = {
    DUE_SOON: "Lease Renewal Due Soon",
    URGENT:   "Lease Renewal Reminder",
    EXPIRED:  "Lease Expired",
    MANUAL:   "Manual Reminder"
};

/* Rows from public.lease_reminders. The database already restricts these to
   the signed-in user, so a visitor only ever receives their own. */
let leaseReminders = [];

/* burial record id -> the visitor profile that owns it (administrators only). */
let plotOwnersByRecordId = {};

/* "block|plot" -> the same profile. Second index so every row of a plot
   resolves to its owner, even if the link points at a different row. */
let plotOwnersByPlotKey = {};

let reservationApplications = [];
let cemeteryMap = null;
let currentMarker = null;
let userGpsMarker = null;
let userGpsWatchId = null;
let userGpsAccuracyCircle = null;
let userGpsHasCentered = false;
let selectedBurialRecord = null;
let navigationRouteLayer = null;
let selectedAdminBurialRecord = null;
let adminNavigationRouteLayer = null;
let adminMap = null;
let adminMarker = null;
let adminGpsMarker = null;
let gpsWatchId = null;
let adminGpsAccuracyCircle = null;
let adminGpsHasCentered = false;
let cemeteryMarkersLayer = null;
let adminMarkersLayer = null;
let cemeteryLocationMarker = null;
let activeRecordMode = "add";
const PLARIDEL_CEMETERY_COORDINATES = [14.8830, 120.8614];

function getReservationApplications() {
    return [];
}

function saveReservationApplicationsToStorage() {
    return;
}

async function loadReservationApplications() {
    if (supabaseClient) {
        const { data, error } = await supabaseClient
            .from("reservation_applications")
            .select("*")
            .order("created_at", { ascending: false });

        if (!error && Array.isArray(data)) {
            reservationApplications = data.map((application) => ({
                id: application.id,
                recordId: application.record_id,
                applicantUserId: application.applicant_user_id,
                applicantFullName: application.applicant_full_name,
                applicantEmail: application.applicant_email,
                applicantContactNumber: application.applicant_contact_number,
                deceasedFullName: application.deceased_full_name,
                deceasedDateOfBirth: application.deceased_date_of_birth,
                deceasedDateOfDeath: application.deceased_date_of_death,
                preferredBurialDate: application.preferred_burial_date,
                status: application.status,
                createdAt: application.created_at
            }));
            return;
        }

        if (error) {
            console.warn("Unable to load reservation applications from Supabase:", error.message);
        }
    }

    reservationApplications = getReservationApplications();
}

async function saveReservationApplication(application) {
    if (!supabaseClient) {
        return true;
    }

    // One application per plot: record_id has a UNIQUE constraint, so the
    // database itself rejects a second application for the same plot.
    const { error } = await supabaseClient
        .from("reservation_applications")
        .insert({
            id: application.id,
            record_id: application.recordId,
            applicant_user_id: application.applicantUserId,
            applicant_full_name: application.applicantFullName,
            applicant_email: application.applicantEmail,
            applicant_contact_number: application.applicantContactNumber,
            deceased_full_name: application.deceasedFullName,
            deceased_date_of_birth: application.deceasedDateOfBirth,
            deceased_date_of_death: application.deceasedDateOfDeath,
            preferred_burial_date: application.preferredBurialDate,
            status: application.status,
            created_at: application.createdAt
        });

    if (error) {
        if (error.code === "23505") {
            alert("This plot already has a reservation application.");
        } else {
            alert("Your application could not be submitted. Please try again.");
        }
        console.warn("Unable to save the reservation application:", error.message);
        return false;
    }

    reservationApplications = [application, ...reservationApplications.filter((item) => item.recordId !== application.recordId)];
    return true;
}

function getReservationApplication(recordId) {
    return reservationApplications.find((application) => application.recordId === recordId);
}

/* The application that still blocks a plot: Pending or Accepted. A Rejected
   application is history, not a reservation. */
function getOpenApplication(recordId) {
    const application = getReservationApplication(recordId);
    return application && application.status !== "Rejected" ? application : null;
}

async function updateReservationApplicationStatus(application, status) {
    application.status = status;
    reservationApplications = reservationApplications.map((item) => item.id === application.id ? application : item);

    if (supabaseClient) {
        const { error } = await supabaseClient
            .from("reservation_applications")
            .update({ status })
            .eq("id", application.id);
        if (error) {
            console.warn("Unable to update reservation application in Supabase:", error.message);
        }
    }
}

/* Recent searches are a per-browser convenience, so the browser is the right
   place to keep them. These two functions used to return immediately, which is
   why the "Recent searches" panel always said "No recent searches yet" even
   after a successful search. */
function getRecentSearches() {
    try {
        const stored = JSON.parse(localStorage.getItem("recentSearches") || "[]");
        return Array.isArray(stored) ? stored : [];
    } catch (error) {
        console.warn("Unable to read recent searches:", error);
        return [];
    }
}

function saveRecentSearches(searches) {
    try {
        localStorage.setItem("recentSearches", JSON.stringify(searches.slice(0, MAX_RECENT_ITEMS)));
    } catch (error) {
        console.warn("Unable to store recent searches:", error);
    }
}

function getGraveConditionNotifications() {
    return [];
}

function saveGraveConditionNotifications(notifications) {
    return;
}

async function getGraveConditionNotificationsFromSupabase() {
    if (!supabaseClient) {
        return null;
    }

    const { data, error } = await supabaseClient
        .from("grave_condition_notifications")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.warn("Unable to load condition notifications from Supabase:", error.message);
        return null;
    }

    return data.map((item) => ({
        id: item.id,
        name: item.name,
        block: item.block,
        plot: item.plot,
        oldCondition: item.old_condition,
        newCondition: item.new_condition,
        timestamp: item.created_at ? new Date(item.created_at).getTime() : Date.now()
    })).slice(0, MAX_RECENT_ITEMS);
}

async function saveGraveConditionNotificationToSupabase(notification) {
    if (!supabaseClient) {
        return false;
    }

    const { error } = await supabaseClient
        .from("grave_condition_notifications")
        .upsert({
            id: notification.id,
            name: notification.name,
            block: notification.block,
            plot: notification.plot,
            old_condition: notification.oldCondition,
            new_condition: notification.newCondition,
            created_at: new Date(notification.timestamp).toISOString()
        }, { onConflict: "id" });

    if (error) {
        console.warn("Unable to save condition notification to Supabase:", error.message);
        return false;
    }

    return true;
}

async function addGraveConditionNotification(record, oldCondition, newCondition) {
    const notification = {
        id: crypto.randomUUID(),
        recordId: record.id,
        name: record.name,
        block: record.block,
        plot: record.plot,
        oldCondition,
        newCondition,
        timestamp: Date.now(),
    };

    await saveGraveConditionNotificationToSupabase(notification);
}

/* The signed-in profile ("currentProfile") is loaded once by auth.js. This
   helper keeps the shape the rest of this file already expects. */
function getCurrentUserProfile() {
    const profile = getCachedProfile();

    if (!profile) {
        return null;
    }

    const record = profile.assigned_record || null;

    return {
        id: profile.id,
        role: profile.role,
        username: profile.username,
        fullName: profile.full_name,
        name: profile.full_name,
        grave: record ? { block: record.block, plot: record.plot } : null,
        assignedRecord: record
    };
}

/* A visitor sees only updates for their own plot; an administrator sees all. */
function notificationBelongsToCurrentUser(notification) {
    const currentUser = getCurrentUserProfile();

    if (!currentUser) {
        return false;
    }

    // administrators have no assigned plot, so they may see everything
    if (currentUser.role !== "visitor") {
        return true;
    }

    const record = currentUser.assignedRecord;
    if (!record) {
        return false;
    }

    if (notification.recordId) {
        return notification.recordId === record.id;
    }

    // notifications created before record_id existed fall back to block + plot
    return notification.block === record.block && notification.plot === record.plot;
}

/* Which role a page requires, decided from the whole path.
   Matching the file name only broke on hosts that serve clean URLs such as
   /admin or /admin/ instead of /admin.html, where no guard would apply. */
function expectedRoleForPage() {
    const path = window.location.pathname.toLowerCase();
    const adminPages = /\/(admin|burialrecords|usercreation|reservationsadmin)(\.html)?\/?$/;

    return adminPages.test(path) ? "admin" : "visitor";
}

/* =========================================================================
   LEASE RENEWAL REMINDERS
   -------------------------------------------------------------------------
   One plot has one lease, so the lease dates live on the burial_records row
   (lease_start_date / lease_expiration_date), NOT in a separate table.

   The lease STATUS is never stored. It is worked out from the expiration date
   every time it is displayed, so it can never go stale and nobody has to
   maintain it day by day.
   ========================================================================= */

/* Text from the database is put into HTML, so it is escaped first. Plot names
   originate from reservation applications, which visitors fill in. */
function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/* "2027-06-30" -> Date at LOCAL midnight. new Date("2027-06-30") would be read
   as UTC and can land on the previous day in +08:00. */
function parseDateOnly(value) {
    const parts = String(value || "").split("-").map(Number);

    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
        return null;
    }

    return new Date(parts[0], parts[1] - 1, parts[2]);
}

/* Days from today until that date; negative once it has passed.
   Always calculated from the current date - never stored, never hard-coded. */
function daysUntil(value) {
    const target = parseDateOnly(value);

    if (!target) {
        return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function getLeaseStatus(expirationDate) {
    const days = daysUntil(expirationDate);

    if (days === null)               return "No Lease";
    if (days <= 0)                   return "Expired";
    if (days <= LEASE_URGENT_DAYS)   return "Urgent Renewal";
    if (days <= LEASE_DUE_SOON_DAYS) return "Due Soon";

    return "Active";
}

/* The reminder this lease deserves RIGHT NOW, or null while it is Active.
   The ranges do not overlap, so at most one can ever apply at a time. */
function getLeaseReminderType(expirationDate) {
    switch (getLeaseStatus(expirationDate)) {
        case "Expired":        return LEASE_REMINDER.EXPIRED;
        case "Urgent Renewal": return LEASE_REMINDER.URGENT;
        case "Due Soon":       return LEASE_REMINDER.DUE_SOON;
        default:               return null;
    }
}

function leaseStatusClass(status) {
    return "status " + String(status).toLowerCase().replace(/\s+/g, "-");
}

function daysRemainingText(days) {
    if (days === null) return "-";
    if (days < 0)      return Math.abs(days) + " day" + (Math.abs(days) === 1 ? "" : "s") + " overdue";
    if (days === 0)    return "Expires today";
    return days + " day" + (days === 1 ? "" : "s");
}

/* The wording the visitor reads, and that is stored with the reminder. */
function buildLeaseReminderMessage(record, reminderType) {
    const days = daysUntil(record.lease_expiration_date);
    const expires = formatDisplayDate(record.lease_expiration_date);
    const where = record.block + ", Plot " + record.plot;

    if (reminderType === LEASE_REMINDER.EXPIRED || days <= 0) {
        return `Your cemetery plot lease for ${where} expired on ${expires}. Please contact the cemetery administration for lease renewal.`;
    }

    return `Your cemetery plot lease for ${where} will expire on ${expires} (${days} day${days === 1 ? "" : "s"} remaining). Please contact the cemetery administration for lease renewal.`;
}

async function loadLeaseRemindersFromSupabase() {
    if (!supabaseClient) {
        return;
    }

    const { data, error } = await supabaseClient
        .from("lease_reminders")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.warn("Unable to load lease reminders from Supabase:", error.message);
        return;
    }

    leaseReminders = Array.isArray(data) ? data : [];
}

/* Which visitor owns which plot - profiles.assigned_record_id is the link.
   Only an administrator may read other people's profiles, so this is only
   called on the admin dashboard. */
async function loadPlotOwners() {
    if (!supabaseClient) {
        return;
    }

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name, username, role, assigned_record_id")
        .not("assigned_record_id", "is", null);

    if (error) {
        console.warn("Unable to load plot owners:", error.message);
        return;
    }

    plotOwnersByRecordId = {};
    plotOwnersByPlotKey = {};
    (data || []).forEach((profile) => {
        plotOwnersByRecordId[profile.assigned_record_id] = profile;

        /* profiles.assigned_record_id points at ONE burial_records row. If a plot
           were ever held by more than one row, the owner would otherwise only be
           found for the row the link points at. Keying on block + plot as well
           means every row of that plot resolves to the same owner. */
        const plot = burialRecords.find((item) => item.id === profile.assigned_record_id);
        if (plot) {
            plotOwnersByPlotKey[plotOwnerKey(plot)] = profile;
        }
    });
}

function getPlotOwner(recordId) {
    return plotOwnersByRecordId[recordId] || null;
}

/* A stable key for "the plot", built the same way supabase/03_data_integrity.sql
   normalises the stored values ("Block C" + "C-47"), so "Block C"/"C" and
   "A - 023"/"A-023" still resolve to the same plot. */
function plotOwnerKey(record) {
    const block = String(record.block || "").toLowerCase().replace(/^block\s*/, "").replace(/\s+/g, "");
    const plot = String(record.plot || "").toLowerCase().replace(/\s+/g, "");
    return block + "|" + plot;
}

/* The owner of the plot a burial record sits in.
   1) the account linked to this exact row (profiles.assigned_record_id), then
   2) the account linked to whichever row holds the same block + plot.
   Returns null when nobody owns the plot - the record is still displayed. */
function getPlotOwnerForRecord(record) {
    if (!record) {
        return null;
    }

    if (plotOwnersByRecordId[record.id]) {
        return plotOwnersByRecordId[record.id];
    }

    return plotOwnersByPlotKey[plotOwnerKey(record)] || null;
}

/* The name to display. Empty string when the plot has no owner account, so the
   caller can decide what to show (the table shows "Not Assigned"). */
function getPlotOwnerName(record) {
    const owner = getPlotOwnerForRecord(record);

    if (!owner) {
        return "";
    }

    return owner.full_name || owner.username || "";
}

function findStoredLeaseReminder(recordId, reminderType, expirationDate) {
    if (!reminderType) {
        return null;
    }

    return leaseReminders.find((row) =>
        row.record_id === recordId &&
        row.reminder_type === reminderType &&
        row.lease_expiration_date === expirationDate) || null;
}

/* Writes one reminder. The table has UNIQUE (record_id, reminder_type,
   lease_expiration_date), so a duplicate is impossible: error 23505 simply
   means "already there" and is not a failure. */
async function saveLeaseReminder({ record, reminderType, recipientProfileId, sentBy = null }) {
    if (!supabaseClient || !record || !recipientProfileId || !record.lease_expiration_date) {
        return { error: "missing lease information" };
    }

    const { data, error } = await supabaseClient
        .from("lease_reminders")
        .insert({
            record_id: record.id,
            recipient_profile_id: recipientProfileId,
            reminder_type: reminderType,
            message: buildLeaseReminderMessage(record, reminderType),
            lease_expiration_date: record.lease_expiration_date,
            sent_by: sentBy
        })
        .select()
        .single();

    if (error) {
        if (error.code === "23505") {
            return { duplicate: true };
        }

        console.warn("Unable to save the lease reminder:", error.message);
        return { error: error.message };
    }

    leaseReminders = [data, ...leaseReminders];
    return { reminder: data };
}

/* Runs once after sign-in. Creates the one reminder the lease currently
   deserves, and nothing else - so loading the page a hundred times still
   results in exactly one reminder per lease period. This is also what makes
   the reminder appear on any device: it lives in Supabase, not in the browser. */
async function generateDueLeaseReminders() {
    const profile = getCachedProfile();

    if (!profile || profile.role === "admin" || !profile.assigned_record_id) {
        return;
    }

    const record = burialRecords.find((item) => item.id === profile.assigned_record_id)
                || profile.assigned_record
                || null;

    if (!record || !record.lease_expiration_date) {
        return;
    }

    const reminderType = getLeaseReminderType(record.lease_expiration_date);

    if (!reminderType) {
        return;   // the lease is still Active
    }

    if (findStoredLeaseReminder(record.id, reminderType, record.lease_expiration_date)) {
        return;   // already recorded for this lease period
    }

    await saveLeaseReminder({ record, reminderType, recipientProfileId: profile.id });
}

function getAssignedPlotRecord() {
    const profile = getCachedProfile();

    if (!profile || !profile.assigned_record_id) {
        return null;
    }

    return burialRecords.find((item) => item.id === profile.assigned_record_id)
        || profile.assigned_record
        || null;
}

/* The reminders the signed-in visitor should see: the one their lease
   currently deserves, plus anything an administrator sent by hand. Only the
   CURRENT lease period is shown, so renewing a lease clears the old reminder
   by itself. */
function leaseReminderItemsForRecord(record) {
    const items = [];

    if (!record || !record.lease_expiration_date) {
        return items;
    }

    const reminderType = getLeaseReminderType(record.lease_expiration_date);

    if (reminderType) {
        const stored = findStoredLeaseReminder(record.id, reminderType, record.lease_expiration_date);

        items.push({
            title: reminderType,
            message: buildLeaseReminderMessage(record, reminderType),
            when: stored
                ? "Recorded " + formatRelativeActivityTime(new Date(stored.created_at).getTime())
                : "Due now"
        });
    }

    leaseReminders
        .filter((row) => row.record_id === record.id
            && row.reminder_type === LEASE_REMINDER.MANUAL
            && row.lease_expiration_date === record.lease_expiration_date)
        .forEach((row) => items.push({
            title: LEASE_REMINDER.URGENT,
            message: row.message,
            when: "Sent by the administration " + formatRelativeActivityTime(new Date(row.created_at).getTime())
        }));

    return items;
}

function getVisitorLeaseReminderItems() {
    return leaseReminderItemsForRecord(getAssignedPlotRecord());
}

/* -------------------------------------------------------------------------
   VISITOR - the Lease Renewal card
   ------------------------------------------------------------------------- */
function renderLeaseSummary() {
    const summaryElement = document.getElementById("leaseSummary");
    const listElement = document.getElementById("leaseReminderList");

    if (!summaryElement || !listElement) {
        return;
    }

    const record = getAssignedPlotRecord();

    if (!record) {
        summaryElement.innerHTML = '<div class="lease-row"><span>Assigned plot</span><strong>None yet</strong></div>';
        listElement.innerHTML = '<div class="notification-empty">No cemetery plot is assigned to your account yet.</div>';
        return;
    }

    const days = daysUntil(record.lease_expiration_date);
    const status = getLeaseStatus(record.lease_expiration_date);

    summaryElement.innerHTML = `
        <div class="lease-row"><span>Block / Plot</span><strong>${escapeHtml(record.block)} / ${escapeHtml(record.plot)}</strong></div>
        <div class="lease-row"><span>Plot Owner</span><strong>${escapeHtml(record.name || "Available Plot")}</strong></div>
        <div class="lease-row"><span>Lease Start</span><strong>${record.lease_start_date ? escapeHtml(formatDisplayDate(record.lease_start_date)) : "-"}</strong></div>
        <div class="lease-row"><span>Lease Expiration</span><strong>${record.lease_expiration_date ? escapeHtml(formatDisplayDate(record.lease_expiration_date)) : "-"}</strong></div>
        <div class="lease-row"><span>Days Remaining</span><strong>${daysRemainingText(days)}</strong></div>
        <div class="lease-row"><span>Lease Status</span><strong><span class="${leaseStatusClass(status)}">${status}</span></strong></div>
    `;

    const items = leaseReminderItemsForRecord(record);

    // "active" and "no lease recorded at all" are different situations
    const emptyMessage = status === "No Lease"
        ? "No lease has been recorded for your plot yet. Please contact the cemetery administration."
        : "Your lease is active. There is nothing to renew at the moment.";

    listElement.innerHTML = items.length === 0
        ? `<div class="notification-empty">${emptyMessage}</div>`
        : items.map((item) => `
            <div class="notification-item lease">
                <p><strong>&#128276; ${escapeHtml(item.title)}</strong></p>
                <p>${escapeHtml(item.message)}</p>
                <span>${escapeHtml(item.when)}</span>
            </div>
        `).join("");
}

/* -------------------------------------------------------------------------
   ADMIN - the Lease Renewal Reminders table
   ------------------------------------------------------------------------- */
/* Every plot with a lease that is not simply Active, most urgent first. */
function getLeaseAttentionRows() {
    return burialRecords
        .filter((record) => record.lease_expiration_date)
        .map((record) => {
            const days = daysUntil(record.lease_expiration_date);
            return { record, days, status: getLeaseStatus(record.lease_expiration_date) };
        })
        .filter((row) => row.status !== "Active")
        .sort((a, b) => a.days - b.days);
}

function renderAdminLeaseReminders() {
    const body = document.getElementById("leaseReminderTableBody");
    const summaryElement = document.getElementById("leaseReminderSummary");

    if (!body) {
        return;
    }

    const rows = getLeaseAttentionRows();
    const expired = rows.filter((row) => row.days <= 0).length;
    const within7 = rows.filter((row) => row.days > 0 && row.days <= LEASE_URGENT_DAYS).length;
    const within30 = rows.filter((row) => row.days > LEASE_URGENT_DAYS && row.days <= LEASE_DUE_SOON_DAYS).length;

    if (summaryElement) {
        summaryElement.textContent = rows.length === 0
            ? "No leases need attention right now."
            : `${rows.length} lease${rows.length === 1 ? "" : "s"} need attention - ${expired} expired, ${within7} expiring within 7 days, ${within30} within 30 days.`;
    }

    if (rows.length === 0) {
        body.innerHTML = '<tr><td colspan="8" class="empty-state">No leases need attention right now.</td></tr>';
        return;
    }

    body.innerHTML = rows.map(({ record, days, status }) => {
        const owner = getPlotOwner(record.id);
        const dueType = getLeaseReminderType(record.lease_expiration_date);
        const manual = findStoredLeaseReminder(record.id, LEASE_REMINDER.MANUAL, record.lease_expiration_date);
        const automatic = findStoredLeaseReminder(record.id, dueType, record.lease_expiration_date);
        const last = manual || automatic;

        const reminderCell = last
            ? `${escapeHtml(last.reminder_type)}<br><span class="lease-sent">${manual ? "by admin" : "automatic"} ${formatRelativeActivityTime(new Date(last.created_at).getTime())}</span>`
            : '<span class="status no-lease">Not sent</span>';

        const actionCell = owner
            ? `<button class="table-action-btn" data-action="send-lease-reminder" data-record-id="${record.id}">${manual ? "Resend Reminder" : "Send Reminder"}</button>`
            : '<span class="status no-lease">No owner assigned</span>';

        return `
        <tr data-name="${escapeHtml(record.name)}" data-block="${escapeHtml(record.block)}" data-plot="${escapeHtml(record.plot)}">
            <td>${escapeHtml(record.block.replace("Block ", ""))} / ${escapeHtml(record.plot)}</td>
            <td>${escapeHtml(record.name || "Available Plot")}</td>
            <td>${owner ? escapeHtml(owner.full_name) : "-"}</td>
            <td>${escapeHtml(formatDisplayDate(record.lease_expiration_date))}</td>
            <td>${daysRemainingText(days)}</td>
            <td><span class="${leaseStatusClass(status)}">${status}</span></td>
            <td>${reminderCell}</td>
            <td>${actionCell}</td>
        </tr>
    `;
    }).join("");
}

/* "Send Reminder" - finds the plot owner, records a Manual Reminder addressed
   to that account only, and reports the result. The unique constraint means a
   reminder can never be recorded twice for the same lease period, so if one
   already exists the administrator is asked before it is replaced. */
async function sendLeaseReminder(recordId) {
    const record = burialRecords.find((item) => item.id === recordId);

    if (!record) {
        return;
    }

    if (!record.lease_expiration_date) {
        alert("This plot has no lease expiration date yet. Add one by editing the burial record.");
        return;
    }

    const owner = getPlotOwner(record.id);

    if (!owner) {
        alert("This plot has no visitor account assigned, so there is nobody to remind. Assign the grave to a visitor on the User page first.");
        return;
    }

    const existing = findStoredLeaseReminder(record.id, LEASE_REMINDER.MANUAL, record.lease_expiration_date);

    if (existing) {
        const sentOn = new Date(existing.created_at).toLocaleString();

        if (!confirm(`A lease reminder for ${record.block}, Plot ${record.plot} was already sent to ${owner.full_name} on ${sentOn}. Send another one?`)) {
            return;
        }

        const { error: deleteError } = await supabaseClient
            .from("lease_reminders")
            .delete()
            .eq("id", existing.id);

        if (deleteError) {
            console.warn("Unable to replace the previous lease reminder:", deleteError.message);
            alert("The previous reminder could not be replaced. Please try again.");
            return;
        }

        leaseReminders = leaseReminders.filter((row) => row.id !== existing.id);
    }

    const profile = getCachedProfile();
    const saved = await saveLeaseReminder({
        record,
        reminderType: LEASE_REMINDER.MANUAL,
        recipientProfileId: owner.id,
        sentBy: profile ? profile.id : null
    });

    if (saved.error) {
        alert("The reminder could not be sent: " + saved.error);
        return;
    }

    renderAdminLeaseReminders();
    alert(`Lease reminder sent to ${owner.full_name} for ${record.block}, Plot ${record.plot}.`);
}

async function renderConditionNotifications() {
    const listElement = document.getElementById("conditionNotificationList");
    const badgeElement = document.getElementById("notificationBadge");
    if (!listElement) {
        return;
    }

    const supabaseNotifications = await getGraveConditionNotificationsFromSupabase();
    const notifications = (supabaseNotifications || getGraveConditionNotifications())
        .filter(notificationBelongsToCurrentUser)
        .slice(0, MAX_RECENT_ITEMS);

    // a due or expired lease counts towards the same bell
    const count = notifications.length + getVisitorLeaseReminderItems().length;

    if (badgeElement) {
        badgeElement.textContent = count > 0 ? count : "";
        badgeElement.style.display = count > 0 ? "inline-block" : "none";
    }

    if (notifications.length === 0) {
        listElement.innerHTML = `<div class="notification-empty">No condition updates yet.</div>`;
        return;
    }

    listElement.innerHTML = notifications.map((item) => `
        <div class="notification-item">
            <p><strong>${item.name}</strong> (${item.block}, ${item.plot}) grave condition changed from <strong>${item.oldCondition}</strong> to <strong>${item.newCondition}</strong>.</p>
            <span>${new Date(item.timestamp).toLocaleString()}</span>
        </div>
    `).join("");
}

function findBurialRecord(query) {
    const searchTerm = query.trim().toLowerCase();

    if (!searchTerm) {
        return null;
    }

    return burialRecords.find((record) => {
        const fullName = record.name.toLowerCase();
        return fullName === searchTerm || fullName.includes(searchTerm);
    }) || null;
}

function updateBurialDetails(record) {
    const nameElement = document.getElementById("burialName");
    const blockElement = document.getElementById("burialBlock");
    const plotElement = document.getElementById("burialPlot");
    const dateElement = document.getElementById("burialDate");
    const statusElement = document.getElementById("burialStatus");

    if (!nameElement || !blockElement || !plotElement || !dateElement || !statusElement) {
        return;
    }

    if (!record) {
        selectedBurialRecord = null;
        focusBurialOnMap(null);
        nameElement.textContent = "No matching record found";
        blockElement.textContent = "-";
        plotElement.textContent = "-";
        dateElement.textContent = "-";
        statusElement.textContent = "Not found";
        return;
    }

    selectedBurialRecord = record;

    nameElement.textContent = record.name;
    blockElement.textContent = record.block;
    plotElement.textContent = record.plot;
    dateElement.textContent = displayDate(record.date);
    statusElement.textContent = record.status;

    if (record.lat !== undefined && record.lng !== undefined) {
        focusBurialOnMap(record);
    }
}

async function renderProfileSidebar(record) {
    const currentUser = getCurrentUserProfile() || {};
    const setValue = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value || "-";
        }
    };

    const userName = currentUser.fullName || currentUser.username || "Visitor";
    const access = currentUser.role === "visitor" ? "Guest Access" : currentUser.role || "Guest Access";
    // the assigned plot comes straight from profiles.assigned_record_id,
    // so it no longer depends on matching block + plot text in the browser
    const assignedRecord = record || currentUser.assignedRecord || null;

    setValue("profileHeaderName", userName);
    setValue("profileUserName", userName);
    setValue("profileUserUsername", currentUser.username || "-");
    setValue("profileUserRole", access);
    setValue("profileUserAccess", access);
    setValue("profileDeceasedName", assignedRecord?.name || "No assigned record");
    setValue("profileDeceasedDate", displayDate(assignedRecord?.date));
    setValue("profileDeceasedStatus", assignedRecord?.status || "-");
    setValue("profilePlotBlock", assignedRecord?.block || "-");
    setValue("profilePlotNumber", assignedRecord?.plot || "-");
    setValue("profilePlotCondition", assignedRecord?.cleanliness || "-");
}

async function initializeProfileSidebar() {
    const profileButton = document.getElementById("profileButton");
    const profileSidebar = document.getElementById("profileSidebar");
    const profileBackdrop = document.getElementById("profileBackdrop");
    const closeButton = document.getElementById("closeProfileButton");

    if (!profileButton || !profileSidebar || !profileBackdrop) {
        return;
    }

    const currentUser = getCurrentUserProfile() || {};

    await renderProfileSidebar(currentUser.assignedRecord || null);

    const setOpenState = (isOpen) => {
        profileSidebar.classList.toggle("is-open", isOpen);
        profileSidebar.setAttribute("aria-hidden", String(!isOpen));
        profileButton.setAttribute("aria-expanded", String(isOpen));
        profileBackdrop.hidden = !isOpen;
    };

    profileButton.addEventListener("click", () => setOpenState(true));
    closeButton?.addEventListener("click", () => setOpenState(false));
    profileBackdrop.addEventListener("click", () => setOpenState(false));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setOpenState(false);
        }
    });
}

function createCemeteryLocationIcon() {
    return L.divIcon({
        html: '<div class="cemetery-location-marker"></div>',
        className: "",
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });
}

function createStatusIcon(status) {
    let color = "#94A3B8"; // Default gray
    
    if (status === "Available") {
        color = "#22C55E"; // Green
    } else if (status === "Occupied") {
        color = "#DC2626"; // Red
    } else if (status === "Reserved") {
        color = "#FACC15"; // Yellow
    }
    
    return L.divIcon({
        html: `<div style="
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: ${color};
            border: 3px solid #fff;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        "></div>`,
        className: "",
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function renderBurialMarkers(map, layerGroup, records) {
    if (!map || !layerGroup) {
        return;
    }

    layerGroup.clearLayers();

    records.forEach((record) => {
        if (record.lat === undefined || record.lng === undefined) {
            return;
        }

        const icon = createStatusIcon(record.status);
        const marker = L.marker([record.lat, record.lng], { icon: icon }).addTo(layerGroup);

        marker.bindPopup(`<strong>${record.name}</strong><br>${record.block} • Plot ${record.plot}<br>Status: ${record.status}`);
        marker.on("click", () => {
            if (map === cemeteryMap) {
                updateBurialDetails(record);
            }
            if (map === adminMap) {
                focusAdminRecord(record);
            }
        });
    });
}

function renderMapMarkers() {
    if (cemeteryMap) {
        if (!cemeteryMarkersLayer) {
            cemeteryMarkersLayer = L.layerGroup().addTo(cemeteryMap);
        }
        cemeteryMarkersLayer.clearLayers();
        // the visitor map used to be cleared but never filled, so it showed no
        // plots at all until a search was run
        renderBurialMarkers(cemeteryMap, cemeteryMarkersLayer, burialRecords);
    }

    if (adminMap) {
        if (!adminMarkersLayer) {
            adminMarkersLayer = L.layerGroup().addTo(adminMap);
        }
        renderBurialMarkers(adminMap, adminMarkersLayer, burialRecords);
    }
}

/* Friendly wording for the three possible geolocation failures. */
function gpsErrorMessage(error) {
    const messages = {
        1: "Location permission was denied. Please allow location access in your browser.",
        2: "Your location is currently unavailable. Please check your GPS or network connection.",
        3: "The GPS request timed out. Please try again."
    };

    return messages[error && error.code] || (error && error.message) || "Unable to get your location.";
}

/* -------------------------------------------------------------------------
   The one place the app asks the browser for a location.

   getCurrentPosition() returns whatever the browser has AT THAT INSTANT, which
   is usually the first and coarsest estimate - on a phone that is the network /
   WiFi guess, often hundreds of metres or whole kilometres out. watchPosition()
   keeps delivering updates, so this helper listens until the fix becomes
   genuinely precise and then stops the watcher.

   It ALWAYS resolves with the best fix received, so a slow or coarse GPS still
   produces a result instead of a timeout error, and the optional onProgress
   callback receives every new fix so the page can show "±2400 m..." while the
   number improves.
   ------------------------------------------------------------------------- */
const GPS_GOOD_ENOUGH_METERS = 20;
const GPS_LONGEST_WAIT_MS = 10000;

function getBestGpsPosition(onProgress) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("GPS is not available in this browser."));
            return;
        }

        let watchId = null;
        let bestPosition = null;
        let settled = false;

        const finish = (position, error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(giveUp);

            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }

            if (position) {
                resolve(position);
            } else {
                reject(error || new Error("Unable to get your location."));
            }
        };

        // a watcher must never be left running, so give up after the maximum wait
        const giveUp = setTimeout(() => {
            finish(bestPosition, new Error(gpsErrorMessage({ code: 3 })));
        }, GPS_LONGEST_WAIT_MS);

        watchId = navigator.geolocation.watchPosition(
            (position) => {
                if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) {
                    bestPosition = position;
                }

                if (typeof onProgress === "function") {
                    onProgress(position);
                }

                // precise enough - there is no reason to keep watching
                if (position.coords.accuracy <= GPS_GOOD_ENOUGH_METERS) {
                    finish(position);
                }
            },
            (error) => {
                // keep a rough fix that already arrived instead of throwing it away
                finish(bestPosition, new Error(gpsErrorMessage(error)));
            },
            {
                enableHighAccuracy: true,
                timeout: GPS_LONGEST_WAIT_MS,
                maximumAge: 0
            }
        );
    });
}

function initializeMap() {
    const mapElement = document.getElementById("map");

    if (!mapElement || typeof L === "undefined") {
        return;
    }

    if (cemeteryMap) {
        cemeteryMap.invalidateSize();
        renderMapMarkers();
        return;
    }

    cemeteryMap = L.map("map", {
        zoomControl: true
    }).setView([14.8829944, 120.8613913], 20);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(cemeteryMap);

    cemeteryMarkersLayer = L.layerGroup().addTo(cemeteryMap);
    cemeteryLocationMarker = L.marker(PLARIDEL_CEMETERY_COORDINATES, {
        icon: createCemeteryLocationIcon()
    }).addTo(cemeteryMap);
    cemeteryLocationMarker.bindPopup("St. James Memorial Park<br>Philippines");

    setTimeout(() => {
        cemeteryMap.invalidateSize();
        cemeteryMap.setView(PLARIDEL_CEMETERY_COORDINATES, 20);
    }, 200);

    renderMapMarkers();

    const locationButton = document.getElementById("useUserCurrentLocationBtn");
    const accuracyElement = document.getElementById("userGpsAccuracy");
    if (locationButton) {
        locationButton.addEventListener("click", () => {
            if (!navigator.geolocation) {
                if (accuracyElement) accuracyElement.textContent = "GPS is not available in this browser.";
                return;
            }

            locationButton.disabled = true;
            locationButton.textContent = "Tracking location...";

            userGpsWatchId = navigator.geolocation.watchPosition(
                (position) => {
                    const latitude = position.coords.latitude;
                    const longitude = position.coords.longitude;
                    const accuracy = position.coords.accuracy;
                    const coordinates = [latitude, longitude];

                    if (userGpsMarker) {
                        userGpsMarker.setLatLng(coordinates);
                    } else {
                        userGpsMarker = L.marker(coordinates)
                            .addTo(cemeteryMap)
                            .bindPopup("Device GPS location");
                    }

                    if (userGpsAccuracyCircle) {
                        userGpsAccuracyCircle.setLatLng(coordinates);
                        userGpsAccuracyCircle.setRadius(accuracy);
                    } else {
                        userGpsAccuracyCircle = L.circle(coordinates, {
                            radius: accuracy,
                            color: "#2563eb",
                            fillColor: "#60a5fa",
                            fillOpacity: 0.2,
                            weight: 2
                        }).addTo(cemeteryMap);
                    }

                    // Center only on the first successful fix; later updates must not move the map.
                    if (!userGpsHasCentered) {
                        cemeteryMap.setView(coordinates, 20);
                        userGpsHasCentered = true;
                    }

                    const userLatitudeElement = document.getElementById("userLatitude");
                    const userLongitudeElement = document.getElementById("userLongitude");
                    if (userLatitudeElement) userLatitudeElement.textContent = latitude.toFixed(6);
                    if (userLongitudeElement) userLongitudeElement.textContent = longitude.toFixed(6);
                    if (accuracyElement) accuracyElement.textContent = `Accuracy: ±${Math.round(accuracy)} meters`;

                    locationButton.disabled = false;
                    locationButton.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> GPS Tracking Active';
                },
                (error) => {
                    if (accuracyElement) accuracyElement.textContent = gpsErrorMessage(error);

                    /* Stop the watcher for EVERY error, not only a denied
                       permission, so the button works again on the next click. */
                    if (userGpsWatchId !== null) {
                        navigator.geolocation.clearWatch(userGpsWatchId);
                        userGpsWatchId = null;
                    }
                    userGpsHasCentered = false;
                    locationButton.disabled = false;
                    locationButton.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Use My GPS Location';
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });
    }
}

function initializeAdminMap() {
    const adminMapElement = document.getElementById("adminMap");

    if (!adminMapElement || typeof L === "undefined") {
        return;
    }

    if (adminMap) {
        adminMap.invalidateSize();
        renderMapMarkers();
        return;
    }

    adminMap = L.map("adminMap", {
        zoomControl: true
    }).setView([14.8829944, 120.8613913], 20);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(adminMap);

    adminMarkersLayer = L.layerGroup().addTo(adminMap);
    cemeteryLocationMarker = L.marker(PLARIDEL_CEMETERY_COORDINATES, {
        icon: createCemeteryLocationIcon()
    }).addTo(adminMap);
    cemeteryLocationMarker.bindPopup("St. James Memorial Park<br>Philippines");

    adminMarker = L.marker(PLARIDEL_CEMETERY_COORDINATES).addTo(adminMap);
    adminMarker.bindPopup("Current cemetery coordinate");

    setTimeout(() => {
        adminMap.invalidateSize();
        adminMap.setView(PLARIDEL_CEMETERY_COORDINATES, 20);
    }, 200);

    renderMapMarkers();

    adminMap.on("move", () => {
        const center = adminMap.getCenter();
        const latitudeElement = document.getElementById("adminLatitude");
        const longitudeElement = document.getElementById("adminLongitude");

        if (latitudeElement) {
            latitudeElement.textContent = center.lat.toFixed(6);
        }

        if (longitudeElement) {
            longitudeElement.textContent = center.lng.toFixed(6);
        }
    });

    const locationButton = document.getElementById("useCurrentLocationBtn");
    const accuracyElement = document.getElementById("gpsAccuracy");
    if (locationButton) {
        locationButton.addEventListener("click", () => {
            if (!navigator.geolocation) {
                if (accuracyElement) accuracyElement.textContent = "GPS is not available in this browser.";
                return;
            }

            // Start one watcher and reuse its marker and accuracy circle for every update.
            if (gpsWatchId !== null) {
                return;
            }

            locationButton.disabled = true;
            locationButton.textContent = "Tracking location...";

            gpsWatchId = navigator.geolocation.watchPosition(
                (position) => {
                    const latitude = position.coords.latitude;
                    const longitude = position.coords.longitude;
                    const accuracy = position.coords.accuracy;
                    const coordinates = [latitude, longitude];

                    if (adminGpsMarker) {
                        adminGpsMarker.setLatLng(coordinates);
                    } else {
                        adminGpsMarker = L.marker(coordinates)
                            .addTo(adminMap)
                            .bindPopup("Device GPS location");
                    }

                    if (adminGpsAccuracyCircle) {
                        adminGpsAccuracyCircle.setLatLng(coordinates);
                        adminGpsAccuracyCircle.setRadius(accuracy);
                    } else {
                        adminGpsAccuracyCircle = L.circle(coordinates, {
                            radius: accuracy,
                            color: "#2563eb",
                            fillColor: "#60a5fa",
                            fillOpacity: 0.2,
                            weight: 2
                        }).addTo(adminMap);
                    }

                    // Center only on the first successful fix; later updates must not move the map.
                    if (!adminGpsHasCentered) {
                        adminMap.setView(coordinates, 20);
                        adminGpsHasCentered = true;
                    }

                    const latitudeElement = document.getElementById("adminLatitude");
                    const longitudeElement = document.getElementById("adminLongitude");
                    if (latitudeElement) latitudeElement.textContent = latitude;
                    if (longitudeElement) longitudeElement.textContent = longitude;
                    if (accuracyElement) accuracyElement.textContent = `Accuracy: ±${Math.round(accuracy)} meters`;

                    locationButton.disabled = false;
                    locationButton.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> GPS Tracking Active';
                },
                (error) => {
                    if (accuracyElement) accuracyElement.textContent = gpsErrorMessage(error);

                    /* Stop the watcher for EVERY error, not only a denied
                       permission. Before this, gpsWatchId stayed set after a
                       timeout or "unavailable" error, and the click handler
                       starts with "if (gpsWatchId !== null) return", so the
                       button did nothing on the second attempt. */
                    if (gpsWatchId !== null) {
                        navigator.geolocation.clearWatch(gpsWatchId);
                        gpsWatchId = null;
                    }
                    adminGpsHasCentered = false;
                    locationButton.disabled = false;
                    locationButton.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Use My GPS Location';
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });
    }
}

function focusAdminRecord(record) {
    if (!adminMap || !record || record.lat === undefined || record.lng === undefined) {
        return;
    }

    selectedAdminBurialRecord = record;

    const burialNameElement = document.getElementById("adminBurialName");
    const burialBlockElement = document.getElementById("adminBurialBlock");
    const burialPlotElement = document.getElementById("adminBurialPlot");
    const burialDateElement = document.getElementById("adminBurialDate");
    const burialStatusElement = document.getElementById("adminBurialStatus");

    if (burialNameElement) burialNameElement.textContent = record.name || "Available Plot";
    if (burialBlockElement) burialBlockElement.textContent = record.block || "-";
    if (burialPlotElement) burialPlotElement.textContent = record.plot || "-";
    if (burialDateElement) burialDateElement.textContent = displayDate(record.date);
    if (burialStatusElement) burialStatusElement.textContent = record.status || "-";

    if (adminMarker) {
        adminMarker.setLatLng([record.lat, record.lng]);
        adminMarker.bindPopup(`<strong>${record.name}</strong><br>${record.block} • Plot ${record.plot}`);
    } else {
        adminMarker = L.marker([record.lat, record.lng]).addTo(adminMap);
        adminMarker.bindPopup(`<strong>${record.name}</strong><br>${record.block} • Plot ${record.plot}`);
    }

    adminMarker.openPopup();

    const latitudeElement = document.getElementById("adminLatitude");
    const longitudeElement = document.getElementById("adminLongitude");

    if (latitudeElement) {
        latitudeElement.textContent = record.lat.toFixed(6);
    }

    if (longitudeElement) {
        longitudeElement.textContent = record.lng.toFixed(6);
    }
}

function findMatchingRecord(query) {
    const searchTerm = query.trim().toLowerCase();

    if (!searchTerm) {
        return null;
    }

    return burialRecords.find((record) => {
        const fullName = String(record.name || "").toLowerCase();
        const block = String(record.block || "").toLowerCase();
        const plot = String(record.plot || "").toLowerCase();
        const owner = getPlotOwnerName(record).toLowerCase();
        return fullName === searchTerm || block === searchTerm || plot === searchTerm || owner === searchTerm || fullName.includes(searchTerm) || block.includes(searchTerm) || plot.includes(searchTerm) || owner.includes(searchTerm);
    }) || null;
}

function filterAdminRecords(searchValue) {
    const rows = document.querySelectorAll("#burialRecordsTableBody tr");
    const query = searchValue.trim().toLowerCase();
    let matchedRecord = null;

    rows.forEach((row) => {
        const rowName = (row.dataset.name || "").toLowerCase();
        const rowBlock = (row.dataset.block || "").toLowerCase();
        const rowPlot = (row.dataset.plot || "").toLowerCase();
        /* the plot owner is searchable too, so typing the owner's name returns
           the burial record that sits in their plot (data-owner is filled in by
           renderBurialRecordsTable from profiles.assigned_record_id) */
        const rowOwner = (row.dataset.owner || "").toLowerCase();
        const isMatch = !query || rowName === query || rowBlock === query || rowPlot === query || rowOwner === query || rowName.includes(query) || rowBlock.includes(query) || rowPlot.includes(query) || rowOwner.includes(query);

        row.classList.toggle("table-row-hidden", !isMatch);
        row.classList.toggle("table-row-highlight", isMatch && query);

        if (isMatch && query && !matchedRecord) {
            matchedRecord = findMatchingRecord(query);
        }
    });

    if (matchedRecord) {
        focusAdminRecord(matchedRecord);
    }
}

function focusBurialOnMap(record) {
    if (!cemeteryMap || !record || record.lat === undefined || record.lng === undefined) {
        return;
    }

    if (currentMarker) {
        cemeteryMap.removeLayer(currentMarker);
    }

    currentMarker = L.marker([record.lat, record.lng]).addTo(cemeteryMap);
    currentMarker.bindPopup(`<strong>${record.name}</strong><br>${record.block} • Plot ${record.plot}`);
}

function renderRecentSearches() {
    const listElement = document.getElementById("recentSearchesList");

    if (!listElement) {
        return;
    }

    const searches = getRecentSearches().slice(0, MAX_RECENT_ITEMS);

    if (searches.length === 0) {
        listElement.innerHTML = `
            <div class="activity">
                <i class="fa-solid fa-clock-rotate-left"></i>
                <div>
                    <h4>No recent searches yet</h4>
                    <p>Search a name to see burial results here.</p>
                </div>
                <span>Ready</span>
            </div>
        `;
        return;
    }

    listElement.innerHTML = searches.map((item) => `
        <div class="activity">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <div>
                <h4>${item.name}</h4>
                <p>${item.block} • Plot ${item.plot}</p>
            </div>
            <span>Recent</span>
        </div>
    `).join("");
}

function addRecentSearch(record) {
    const searches = getRecentSearches();
    const updatedSearches = [record, ...searches.filter((item) => item.name !== record.name)].slice(0, MAX_RECENT_ITEMS);
    saveRecentSearches(updatedSearches);
    renderRecentSearches();
}

function searchBurialRecord() {
    const input = document.getElementById("burialSearchInput");

    if (!input) {
        return;
    }

    const query = input.value;
    const record = findMatchingRecord(query);

    if (!query.trim()) {
        alert("Please enter a deceased name.");
        return;
    }

    updateBurialDetails(record);

    // Ensure the cemetery/user map recenters to the found record
    if (record && typeof focusBurialOnMap === 'function') {
        focusBurialOnMap(record);
    }

    if (record) {
        addRecentSearch(record);
    } else {
        renderRecentSearches();
    }
}

/* Asks the walking-route service for a route, but never waits forever: the
   public OSRM demo server has no service guarantee, and a request that hangs
   used to leave the "Navigate to Grave" button disabled indefinitely. */
async function fetchWalkingRoute(routeUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(routeUrl, { signal: controller.signal });

        if (!response.ok) {
            throw new Error(`The routing service replied with status ${response.status}.`);
        }

        return await response.json();
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("The routing service did not respond in time.");
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function navigateToSelectedGrave() {
    const statusElement = document.getElementById("navigationStatus");
    const navigateButton = document.getElementById("navigateToGraveBtn");
    const record = selectedBurialRecord;

    if (!record || !Number.isFinite(Number(record.lat)) || !Number.isFinite(Number(record.lng))) {
        if (statusElement) statusElement.textContent = "Search for a grave with saved coordinates first.";
        return;
    }

    if (!navigator.geolocation) {
        if (statusElement) statusElement.textContent = "GPS is not available in this browser.";
        return;
    }

    if (navigateButton) {
        navigateButton.disabled = true;
        navigateButton.textContent = "Finding your location...";
    }
    if (statusElement) statusElement.textContent = "Getting your current location...";

    getBestGpsPosition().then(async (position) => {
        const startLatitude = position.coords.latitude;
        const startLongitude = position.coords.longitude;
        const endLatitude = Number(record.lat);
        const endLongitude = Number(record.lng);

        if (userGpsMarker) {
            userGpsMarker.setLatLng([startLatitude, startLongitude]);
        } else {
            userGpsMarker = L.marker([startLatitude, startLongitude])
                .addTo(cemeteryMap)
                .bindPopup("Your current location");
        }

        try {
            const routeUrl = `https://router.project-osrm.org/route/v1/foot/${startLongitude},${startLatitude};${endLongitude},${endLatitude}?overview=full&geometries=geojson&steps=true`;
            const routeData = await fetchWalkingRoute(routeUrl);
            const route = routeData.routes && routeData.routes[0];

            if (!route) throw new Error("No walking route was found.");
            if (navigationRouteLayer) cemeteryMap.removeLayer(navigationRouteLayer);

            const routeCoordinates = route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
            navigationRouteLayer = L.polyline(routeCoordinates, { color: "#d97706", weight: 6, opacity: 0.85 }).addTo(cemeteryMap);
            cemeteryMap.fitBounds(navigationRouteLayer.getBounds(), { padding: [30, 30] });

            const distanceKm = (route.distance / 1000).toFixed(2);
            const durationMinutes = Math.max(1, Math.round(route.duration / 60));
            if (statusElement) statusElement.textContent = `Route to ${record.name || "the grave"}: ${distanceKm} km, about ${durationMinutes} min walking. GPS accuracy: ${Math.round(position.coords.accuracy)} m.`;
        } catch (error) {
            if (statusElement) statusElement.textContent = `Unable to create walking route: ${error.message}`;
        } finally {
            if (navigateButton) {
                navigateButton.disabled = false;
                navigateButton.innerHTML = '<i class="fa-solid fa-route"></i> Navigate to Grave';
            }
        }
    }).catch((error) => {
        if (statusElement) statusElement.textContent = `Unable to get location: ${error.message}`;
        if (navigateButton) {
            navigateButton.disabled = false;
            navigateButton.innerHTML = '<i class="fa-solid fa-route"></i> Navigate to Grave';
        }
    });
}

function navigateToSelectedAdminGrave() {
    const statusElement = document.getElementById("adminNavigationStatus");
    const navigateButton = document.getElementById("adminNavigateToGraveBtn");
    const record = selectedAdminBurialRecord;

    if (!record || !Number.isFinite(Number(record.lat)) || !Number.isFinite(Number(record.lng))) {
        if (statusElement) statusElement.textContent = "Search for a grave with saved coordinates first.";
        return;
    }

    if (!navigator.geolocation) {
        if (statusElement) statusElement.textContent = "GPS is not available in this browser.";
        return;
    }

    if (navigateButton) {
        navigateButton.disabled = true;
        navigateButton.textContent = "Finding your location...";
    }
    if (statusElement) statusElement.textContent = "Getting your current location...";

    getBestGpsPosition().then(async (position) => {
        const startLatitude = position.coords.latitude;
        const startLongitude = position.coords.longitude;
        const endLatitude = Number(record.lat);
        const endLongitude = Number(record.lng);

        if (adminGpsMarker) {
            adminGpsMarker.setLatLng([startLatitude, startLongitude]);
        } else {
            adminGpsMarker = L.marker([startLatitude, startLongitude])
                .addTo(adminMap)
                .bindPopup("Your current location");
        }

        try {
            const routeUrl = `https://router.project-osrm.org/route/v1/foot/${startLongitude},${startLatitude};${endLongitude},${endLatitude}?overview=full&geometries=geojson&steps=true`;
            const routeData = await fetchWalkingRoute(routeUrl);
            const route = routeData.routes && routeData.routes[0];

            if (!route) throw new Error("No walking route was found.");
            if (adminNavigationRouteLayer) adminMap.removeLayer(adminNavigationRouteLayer);

            const routeCoordinates = route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
            adminNavigationRouteLayer = L.polyline(routeCoordinates, { color: "#d97706", weight: 6, opacity: 0.85 }).addTo(adminMap);
            adminMap.fitBounds(adminNavigationRouteLayer.getBounds(), { padding: [30, 30] });

            const distanceKm = (route.distance / 1000).toFixed(2);
            const durationMinutes = Math.max(1, Math.round(route.duration / 60));
            if (statusElement) statusElement.textContent = `Route to ${record.name || "the grave"}: ${distanceKm} km, about ${durationMinutes} min walking. GPS accuracy: ${Math.round(position.coords.accuracy)} m.`;
        } catch (error) {
            if (statusElement) statusElement.textContent = `Unable to create walking route: ${error.message}`;
        } finally {
            if (navigateButton) {
                navigateButton.disabled = false;
                navigateButton.innerHTML = '<i class="fa-solid fa-route"></i> Navigate to Grave';
            }
        }
    }).catch((error) => {
        if (statusElement) statusElement.textContent = `Unable to get location: ${error.message}`;
        if (navigateButton) {
            navigateButton.disabled = false;
            navigateButton.innerHTML = '<i class="fa-solid fa-route"></i> Navigate to Grave';
        }
    });
}

function toggleAddRecordModal(show) {
    const modal = document.getElementById("addRecordModal");

    if (!modal) {
        return;
    }

    modal.classList.toggle("hidden", !show);
    if (!show) {
        // ensure we remove any temporary listeners/state when closing
        try { resetRecordForm(); } catch (e) {}
    }
}

function normalizeDateValue(value) {
    const parsedDate = new Date(value);
    if (!Number.isNaN(parsedDate.getTime())) {
        return parsedDate.toISOString().split("T")[0];
    }
    return value;
}

function formatDisplayDate(value) {
    const parsedDate = new Date(value);
    if (!Number.isNaN(parsedDate.getTime())) {
        return parsedDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }
    return value;
}

/* Dates are stored as YYYY-MM-DD. This renders them for the interface and
   shows "-" when there is no date, so an empty value can never appear as
   "January 1, 1970". */
function displayDate(value) {
    return value ? formatDisplayDate(value) : "-";
}

function updateDashboardStats() {
    const totalBurials = document.getElementById("statsTotalBurials");
    const occupiedPlots = document.getElementById("statsOccupiedPlots");
    const availablePlots = document.getElementById("statsAvailablePlots");
    const reservedPlots = document.getElementById("statsReservedPlots");

    if (totalBurials) {
        totalBurials.textContent = burialRecords.length.toString();
    }

    if (occupiedPlots) {
        occupiedPlots.textContent = burialRecords.filter((record) => record.status === "Occupied").length.toString();
    }

    if (availablePlots) {
        availablePlots.textContent = burialRecords.filter((record) => record.status === "Available").length.toString();
    }

    if (reservedPlots) {
        reservedPlots.textContent = burialRecords.filter((record) => record.status === "Reserved").length.toString();
    }
}

function formatRelativeActivityTime(timestamp) {
    const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));

    if (diffMinutes < 1) {
        return "Just now";
    }

    if (diffMinutes < 60) {
        return `${diffMinutes} min ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) {
        return "Yesterday";
    }

    return `${diffDays} days ago`;
}

/* This panel used to be permanently empty: it read from getRecentBurialActivity(),
   which returned [] and saved nothing anywhere.
   Recent grave condition updates are the only real event log the system keeps,
   so the panel now shows those - the same rows the notification badge counts. */
async function renderRecentBurialActivity() {
    const activityList = document.getElementById("recentBurialActivityList");
    const notificationBadge = document.getElementById("notificationBadge");
    const notificationButton = document.getElementById("notificationButton");

    if (!activityList) {
        return;
    }

    const notifications = await getGraveConditionNotificationsFromSupabase() || [];

    if (notificationBadge) {
        const count = notifications.length;
        notificationBadge.textContent = count > 0 ? count : "";
        notificationBadge.style.display = count > 0 ? "inline-flex" : "none";
    }

    if (notificationButton) {
        notificationButton.title = notifications.length > 0
            ? `${notifications.length} recent updates`
            : "No recent updates";
    }

    if (notifications.length === 0) {
        activityList.innerHTML = '<div class="activity"><p>No recent grave updates yet.</p></div>';
        return;
    }

    activityList.innerHTML = notifications.map((item) => `
        <div class="activity">
            <i class="fa-solid fa-broom"></i>
            <div>
                <h4>${item.name || "Available Plot"} • ${item.block} • Plot ${item.plot}</h4>
                <p>Grave condition changed from ${item.oldCondition} to ${item.newCondition}.</p>
            </div>
            <span>${formatRelativeActivityTime(item.timestamp)}</span>
        </div>
    `).join("");
}

function renderBurialRecordsTable() {
    const tableBody = document.getElementById("burialRecordsTableBody");
    renderMapMarkers();

    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = burialRecords.map((record) => {
        /* The owner is READ from the database relationship
           (profiles.assigned_record_id -> burial_records.id) every time the
           table is drawn - it is never copied onto the burial record itself and
           never typed in by hand. A plot without an owner still appears here. */
        const ownerName = getPlotOwnerName(record);

        return `
        <tr data-name="${escapeHtml(record.name)}" data-block="${escapeHtml(record.block)}" data-plot="${escapeHtml(record.plot)}" data-owner="${escapeHtml(ownerName)}">
            <td>${escapeHtml(record.id)}</td>
            <td>${escapeHtml(record.name)}</td>
            <td>${escapeHtml(String(record.block || "").replace("Block ", ""))}</td>
            <td>${escapeHtml(record.plot)}</td>
            <td class="owner-cell">${ownerName ? escapeHtml(ownerName) : '<span class="owner-none">Not Assigned</span>'}</td>
            <td>${displayDate(record.date)}</td>
            <td><span class="status ${escapeHtml(String(record.status || "").toLowerCase())}">${escapeHtml(record.status)}</span></td>
            <td>
                <button class="table-action-btn" data-action="edit" data-record-id="${escapeHtml(record.id)}">Edit</button>
                <button class="table-action-btn" data-action="view" data-record-id="${escapeHtml(record.id)}">View</button>
                <button class="table-action-btn delete-btn" data-action="delete" data-record-id="${escapeHtml(record.id)}">Remove</button>
            </td>
        </tr>
    `;
    }).join("");

    updateDashboardStats();
}

function getReservationCounts() {
    return {
        reserved: burialRecords.filter((record) => record.status === "Reserved").length,
        available: burialRecords.filter((record) => record.status === "Available").length,
        occupied: burialRecords.filter((record) => record.status === "Occupied").length,
    };
}

/* The visitor page used to force Reserved and Occupied to "0" and hide those
   two cards, so the tiles could never match the data. They now show the real
   numbers, the same as the administrator page. */
function updateUserReservationStats() {
    const counts = getReservationCounts();
    const reservedCount = document.getElementById("userReservedCount");
    const availableCount = document.getElementById("userAvailableCount");
    const occupiedCount = document.getElementById("userOccupiedCount");

    if (reservedCount) {
        reservedCount.textContent = counts.reserved.toString();
    }
    if (availableCount) {
        availableCount.textContent = counts.available.toString();
    }
    if (occupiedCount) {
        occupiedCount.textContent = counts.occupied.toString();
    }
}

function updateAdminReservationStats() {
    const counts = getReservationCounts();
    const reservedCount = document.getElementById("adminReservedCount");
    const availableCount = document.getElementById("adminAvailableCount");
    const occupiedCount = document.getElementById("adminOccupiedCount");

    if (reservedCount) {
        reservedCount.textContent = counts.reserved.toString();
    }
    if (availableCount) {
        availableCount.textContent = counts.available.toString();
    }
    if (occupiedCount) {
        occupiedCount.textContent = counts.occupied.toString();
    }
}

function getDisplayName(record) {
    if (!record) {
        return "";
    }

    return record.status === "Available" ? "Available Plot" : record.name || "";
}

function renderUserReservations() {
    const tableBody = document.getElementById("reservationUserTableBody");
    if (!tableBody) {
        return;
    }

    // A visitor only receives their own application rows (enforced by RLS).
    // A plot with a pending or accepted application shows that status instead
    // of the Reserve button. A REJECTED application must not hide the plot,
    // otherwise the visitor could never apply for it again.
    const availableRecords = burialRecords.filter((record) => record.status === "Available");

    if (availableRecords.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 20px; color: #64748b;">
                    No available plots at the moment.
                </td>
            </tr>
        `;
    } else {
        tableBody.innerHTML = availableRecords.map((record) => {
            const application = getOpenApplication(record.id);
            const action = application
                ? `<span class="status reserved">Application ${application.status}</span>`
                : `<button class="table-action-btn" data-action="reservation" data-reservation-status="available" data-record-id="${record.id}">
                        Reserve
                    </button>`;

            return `
            <tr data-name="${record.name}" data-block="${record.block}" data-plot="${record.plot}">
                <td>${record.id}</td>
                <td>${getDisplayName(record)}</td>
                <td>${record.block.replace("Block ", "")}</td>
                <td>${record.plot}</td>
                <td><span class="status ${record.status.toLowerCase()}">${record.status}</span></td>
                <td>${action}</td>
            </tr>
        `;
        }).join("");
    }

    updateUserReservationStats();
}

function renderAdminReservations() {
    const tableBody = document.getElementById("reservationsAdminTableBody");
    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = burialRecords.map((record) => {
        /* The button is for applications still awaiting a decision. Accepting
           reserves the plot and rejecting returns it to Available, so once
           either has happened the decision is made: only Pending applications
           offer View Application, and only Pending can be reviewed again. */
        const application = getReservationApplication(record.id);
        const applicationButton = application && application.status === "Pending"
            ? `<button class="table-action-btn" data-action="view-application" data-record-id="${record.id}">View Application (${application.status})</button>`
            : "";

        return `
        <tr data-name="${record.name}" data-block="${record.block}" data-plot="${record.plot}">
            <td>${record.id}</td>
            <td>${getDisplayName(record)}</td>
            <td>${record.block.replace("Block ", "")}</td>
            <td>${record.plot}</td>
            <td><span class="status ${record.status.toLowerCase()}">${record.status}</span></td>
            <td>
                ${applicationButton}
                <button class="table-action-btn" data-action="toggle-reservation" data-reservation-status="${record.status.toLowerCase()}" data-record-id="${record.id}">
                    ${record.status === "Reserved" ? "Release" : record.status === "Available" ? "Reserve" : "Locked"}
                </button>
            </td>
        </tr>
    `;
    }).join("");

    updateAdminReservationStats();
}

function openReservationApplicationModal(recordId) {
    const record = burialRecords.find((item) => item.id === recordId);
    const modal = document.getElementById("reservationApplicationModal");
    const form = document.getElementById("reservationApplicationForm");
    if (!record || !modal || !form) {
        return;
    }

    form.reset();
    form.querySelectorAll("input:not([type=hidden]), button[type=submit]").forEach((element) => {
        element.disabled = false;
    });
    document.querySelector(".application-note")?.classList.remove("visible");
    document.getElementById("applicationRecordId").value = record.id;
    document.getElementById("applicationDeceasedFullName").value = record.name || "";
    modal.classList.remove("hidden");
}

function closeReservationApplicationModal() {
    document.getElementById("reservationApplicationModal")?.classList.add("hidden");
}

/* -------------------------------------------------------------------------
   RESERVATION CONTACT NUMBER - EXACTLY 11 DIGITS
   -------------------------------------------------------------------------
   A Philippine mobile number is 11 digits (09XXXXXXXXX). The same rule is
   declared on the input itself in reservationuser.html
   (inputmode + maxlength + pattern), so the browser and this check agree and
   the form cannot be submitted with 10 or 12 digits.
   ------------------------------------------------------------------------- */
const CONTACT_NUMBER_PATTERN = /^[0-9]{11}$/;

/* Keeps only digits, and never more than 11 of them. */
function normalizeContactNumber(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 11);
}

function isValidContactNumber(value) {
    return CONTACT_NUMBER_PATTERN.test(String(value || ""));
}

async function submitReservationApplication(event) {
    event.preventDefault();
    const form = event.target;

    /* The contact number is cleaned and checked BEFORE the browser's own
       validation, and the order matters: a pasted "0917-123-4567" still holds
       its dashes, so form.checkValidity() would reject it with a generic
       "Please match the requested format" bubble and the message below would
       never be reached. Cleaning first turns it into 11 digits. */
    const contactField = document.getElementById("applicationApplicantContactNumber");

    if (contactField) {
        // digits only: removes spaces, dashes and a "+63" prefix
        contactField.value = normalizeContactNumber(contactField.value);

        if (!isValidContactNumber(contactField.value)) {
            alert("Contact number must be exactly 11 digits (for example 09171234567).");
            contactField.focus();
            return;
        }
    }

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const recordId = document.getElementById("applicationRecordId").value;
    const record = burialRecords.find((item) => item.id === recordId);
    if (!record || record.status !== "Available") {
        alert("This plot is no longer available.");
        closeReservationApplicationModal();
        return;
    }

    const profile = getCachedProfile();
    if (!profile) {
        alert("Your session has ended. Please sign in again.");
        return;
    }

    const application = {
        id: crypto.randomUUID(),
        recordId,
        applicantUserId: profile.id,
        applicantFullName: document.getElementById("applicationApplicantFullName").value.trim(),
        applicantEmail: document.getElementById("applicationApplicantEmail").value.trim(),
        applicantContactNumber: document.getElementById("applicationApplicantContactNumber").value.trim(),
        deceasedFullName: document.getElementById("applicationDeceasedFullName").value.trim(),
        deceasedDateOfBirth: document.getElementById("applicationDeceasedDateOfBirth").value,
        deceasedDateOfDeath: document.getElementById("applicationDeceasedDateOfDeath").value,
        preferredBurialDate: document.getElementById("applicationPreferredBurialDate").value,
        status: "Pending",
        createdAt: new Date().toISOString()
    };

    // A visitor only FILES the application. The administrator approves it, and
    // only then does the plot become "Reserved". The browser must never write
    // to burial_records here - a visitor has no permission to do so any more.
    const saved = await saveReservationApplication(application);
    if (!saved) {
        return;
    }
    const completionMessage = form.querySelector(".application-note");
    if (completionMessage) {
        completionMessage.classList.add("visible");
    }
    form.querySelectorAll("input:not([type=hidden]), button[type=submit]").forEach((element) => {
        element.disabled = true;
    });
    renderUserReservations();
    renderAdminReservations();
    updateDashboardStats();
}

function openReviewApplicationModal(recordId) {
    const application = getReservationApplication(recordId);
    const record = burialRecords.find((item) => item.id === recordId);
    const modal = document.getElementById("reviewApplicationModal");
    if (!application || !record || !modal) {
        return;
    }

    document.getElementById("reviewApplicantFullName").textContent = application.applicantFullName;
    document.getElementById("reviewApplicantEmail").textContent = application.applicantEmail;
    document.getElementById("reviewApplicantContactNumber").textContent = application.applicantContactNumber;
    document.getElementById("reviewDeceasedFullName").textContent = application.deceasedFullName;
    document.getElementById("reviewDeceasedDateOfBirth").textContent = application.deceasedDateOfBirth;
    document.getElementById("reviewDeceasedDateOfDeath").textContent = application.deceasedDateOfDeath;
    document.getElementById("reviewPreferredBurialDate").textContent = application.preferredBurialDate;
    document.getElementById("reviewApplicationStatus").textContent = application.status;
    modal.dataset.applicationId = application.id;
    modal.classList.remove("hidden");
}

function closeReviewApplicationModal() {
    document.getElementById("reviewApplicationModal")?.classList.add("hidden");
}

async function reviewReservationApplication(status) {
    const modal = document.getElementById("reviewApplicationModal");
    const application = reservationApplications.find((item) => item.id === modal?.dataset.applicationId);
    if (!application) {
        return;
    }

    await updateReservationApplicationStatus(application, status);

    const record = burialRecords.find((item) => item.id === application.recordId);

    if (record && status === "Accepted") {
        // approval is what actually reserves the plot
        record.status = "Reserved";
        record.name = application.deceasedFullName;
        if (!await updateBurialRecord({ id: record.id, status: record.status, name: record.name })) {
            alert("The plot could not be updated. Please try again.");
        }
    } else if (record && status === "Rejected") {
        record.status = "Available";
        record.name = "";
        /* A rejection is a finished decision, so the application is discarded.
           This matters because reservation_applications.record_id is UNIQUE:
           a leftover rejected row would block every future application for
           this plot with error 23505 ("This plot already has a reservation
           application.") even though the plot is Available again. */
        await deleteReservationApplicationForRecord(record.id);
        await updateBurialRecord({ id: record.id, status: record.status, name: record.name });
    }

    closeReviewApplicationModal();
    renderAdminReservations();
    renderUserReservations();
    renderMapMarkers();
    updateDashboardStats();
}

async function reserveBurialRecord(recordId) {
    const record = burialRecords.find((item) => item.id === recordId);
    if (!record || record.status !== "Available") {
        return;
    }

    openReservationApplicationModal(recordId);
}

async function toggleReservationForAdmin(recordId) {
    const record = burialRecords.find((item) => item.id === recordId);
    if (!record) {
        return;
    }

    if (record.status === "Reserved") {
        const confirmed = confirm(`Release reservation for ${record.name || "this plot"} (Plot ${record.plot})?`);
        if (!confirmed) {
            return;
        }
        record.status = "Available";
        record.name = "";
        // releasing a plot also discards its application, so the plot can be
        // applied for again and no stale application is left behind
        await deleteReservationApplicationForRecord(record.id);
    } else if (record.status === "Available") {
        record.status = "Reserved";
    } else {
        alert("Occupied plots cannot be reserved or released.");
        return;
    }

    await updateBurialRecord({ id: record.id, status: record.status, name: record.name });
    renderAdminReservations();
    renderUserReservations();
    renderMapMarkers();
    updateDashboardStats();
}

function filterReservationRows(tableBodyId, query) {
    const rows = document.querySelectorAll(`#${tableBodyId} tr`);
    const normalizedQuery = query.trim().toLowerCase();

    rows.forEach((row) => {
        const name = (row.dataset.name || "").toLowerCase();
        const block = (row.dataset.block || "").toLowerCase();
        const plot = (row.dataset.plot || "").toLowerCase();
        const isMatch = !normalizedQuery || name.includes(normalizedQuery) || block.includes(normalizedQuery) || plot.includes(normalizedQuery);
        row.style.display = isMatch ? "table-row" : "none";
    });
}

function initializeUserReservations() {
    const body = document.getElementById("reservationUserPage");
    if (!body) {
        return;
    }

    const searchInput = document.getElementById("reservationSearchInput");
    const tableBody = document.getElementById("reservationUserTableBody");
    const applicationForm = document.getElementById("reservationApplicationForm");
    const closeApplicationButton = document.getElementById("closeReservationApplicationModal");
    const cancelApplicationButton = document.getElementById("cancelReservationApplicationBtn");

    renderUserReservations();

    applicationForm?.addEventListener("submit", submitReservationApplication);
    closeApplicationButton?.addEventListener("click", closeReservationApplicationModal);
    cancelApplicationButton?.addEventListener("click", closeReservationApplicationModal);

    /* Contact number: digits only, never more than 11, cleaned while typing so
       a letter, a space or a dash can never reach the form. */
    const contactInput = document.getElementById("applicationApplicantContactNumber");
    contactInput?.addEventListener("input", () => {
        const digits = normalizeContactNumber(contactInput.value);
        if (contactInput.value !== digits) {
            contactInput.value = digits;
        }
    });

    /* Pasting "0917-123-4567" would be cut to "0917-123-45" by maxlength before
       the handler above can clean it, so the paste is taken over here. */
    contactInput?.addEventListener("paste", (event) => {
        const clipboard = event.clipboardData || window.clipboardData;
        const pasted = clipboard ? clipboard.getData("text") : "";

        if (/\D/.test(pasted)) {
            event.preventDefault();
            contactInput.value = normalizeContactNumber(pasted);
        }
    });

    if (searchInput) {
        searchInput.addEventListener("input", (event) => filterReservationRows("reservationUserTableBody", event.target.value));
        searchInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                filterReservationRows("reservationUserTableBody", searchInput.value);
            }
        });
    }

    if (tableBody) {
        tableBody.addEventListener("click", async (event) => {
            const button = event.target.closest(".table-action-btn");
            if (!button) {
                return;
            }
            const action = button.dataset.action;
            const recordId = button.dataset.recordId;
            if (action === "reservation") {
                await reserveBurialRecord(recordId);
            }
        });
    }
}

function initializeAdminReservations() {
    const body = document.getElementById("reservationsAdminPage");
    if (!body) {
        return;
    }

    const searchInput = document.getElementById("reservationAdminSearchInput");
    const tableBody = document.getElementById("reservationsAdminTableBody");
    const closeReviewButton = document.getElementById("closeReviewApplicationModal");
    const acceptButton = document.getElementById("acceptReservationApplicationBtn");
    const rejectButton = document.getElementById("rejectReservationApplicationBtn");

    renderAdminReservations();

    closeReviewButton?.addEventListener("click", closeReviewApplicationModal);
    acceptButton?.addEventListener("click", () => reviewReservationApplication("Accepted"));
    rejectButton?.addEventListener("click", () => reviewReservationApplication("Rejected"));

    if (searchInput) {
        searchInput.addEventListener("input", (event) => filterReservationRows("reservationsAdminTableBody", event.target.value));
        searchInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                filterReservationRows("reservationsAdminTableBody", searchInput.value);
            }
        });
    }

    if (tableBody) {
        tableBody.addEventListener("click", async (event) => {
            const button = event.target.closest(".table-action-btn");
            if (!button) {
                return;
            }
            const action = button.dataset.action;
            const recordId = button.dataset.recordId;
            if (action === "toggle-reservation") {
                await toggleReservationForAdmin(recordId);
            } else if (action === "view-application") {
                openReviewApplicationModal(recordId);
            }
        });
    }
}

function getPhilippineDate() {
    const now = new Date();
    const philippineTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    return philippineTime.toISOString().split("T")[0];
}

function updateNameFieldRequirement(status) {
    const nameInput = document.getElementById("recordName");
    if (!nameInput) {
        return;
    }
    if (status === "Available") {
        nameInput.value = "";
        nameInput.removeAttribute("required");
    } else {
        nameInput.setAttribute("required", "required");
    }
}

function resetRecordForm() {
    const nameInput = document.getElementById("recordName");
    const blockInput = document.getElementById("recordBlock");
    const plotInput = document.getElementById("recordPlot");
    const dateInput = document.getElementById("recordDate");
    const statusInput = document.getElementById("recordStatus");
    const cleanlinessInput = document.getElementById("recordCleanliness");
    const latitudeInput = document.getElementById("recordLatitude");
    const longitudeInput = document.getElementById("recordLongitude");
    const leaseStartInput = document.getElementById("recordLeaseStart");
    const leaseExpirationInput = document.getElementById("recordLeaseExpiration");
    const ownerInput = document.getElementById("recordPlotOwner");

    document.getElementById("recordId").value = "";
    nameInput.value = "";
    blockInput.value = "";
    plotInput.value = "";
    dateInput.value = activeRecordMode === "edit" ? "" : getPhilippineDate();
    statusInput.value = "Occupied";
    cleanlinessInput.value = "Clean";
    if (leaseStartInput) leaseStartInput.value = "";
    if (leaseExpirationInput) leaseExpirationInput.value = "";
    // default to the cemetery centre: the old defaults (14.954621 / 120.896542)
    // are about 9 km away, so saving without touching the fields put the plot
    // outside the cemetery
    latitudeInput.value = PLARIDEL_CEMETERY_COORDINATES[0];
    longitudeInput.value = PLARIDEL_CEMETERY_COORDINATES[1];
    document.getElementById("recordModalTitle").textContent = "Add Burial Record";

    const saveButton = document.getElementById("saveRecordBtn");
    saveButton.textContent = "Save Record";
    saveButton.disabled = false;

    nameInput.disabled = false;
    blockInput.disabled = false;
    plotInput.disabled = false;
    dateInput.disabled = false;
    statusInput.disabled = false;
    cleanlinessInput.disabled = false;
    latitudeInput.disabled = false;
    longitudeInput.disabled = false;
    if (leaseStartInput) leaseStartInput.disabled = false;
    if (leaseExpirationInput) leaseExpirationInput.disabled = false;
    if (ownerInput) {
        ownerInput.value = "";
        ownerInput.disabled = false;
    }
    // remove live listeners when resetting
    latitudeInput.oninput = null;
    longitudeInput.oninput = null;
    editingRecordId = null;
    updateNameFieldRequirement(statusInput.value);
}

function openRecordModal(mode, record) {
    const modalTitle = document.getElementById("recordModalTitle");
    const saveButton = document.getElementById("saveRecordBtn");
    const nameInput = document.getElementById("recordName");
    const blockInput = document.getElementById("recordBlock");
    const plotInput = document.getElementById("recordPlot");
    const dateInput = document.getElementById("recordDate");
    const statusInput = document.getElementById("recordStatus");
    const cleanlinessInput = document.getElementById("recordCleanliness");
    const latitudeInput = document.getElementById("recordLatitude");
    const longitudeInput = document.getElementById("recordLongitude");
    const leaseStartInput = document.getElementById("recordLeaseStart");
    const leaseExpirationInput = document.getElementById("recordLeaseExpiration");
    const ownerInput = document.getElementById("recordPlotOwner");

    activeRecordMode = mode;
    resetRecordForm();

    if (statusInput) {
        statusInput.onchange = () => updateNameFieldRequirement(statusInput.value);
    }

    if (mode === "edit" && record) {
        modalTitle.textContent = "Edit Burial Record";
        saveButton.textContent = "Update Record";
        document.getElementById("recordId").value = record.id;
        nameInput.value = record.name;
        blockInput.value = record.block;
        plotInput.value = record.plot;
        dateInput.value = normalizeDateValue(record.date);
        statusInput.value = record.status;
        /* Carry the SAVED condition into the form. Without this the value left
           behind by resetRecordForm() ("Clean") would be written back over a
           "Dirty" plot, and handleAddBurialRecord() would then see a change
           and log a false "Dirty -> Clean" notification for the visitor. */
        cleanlinessInput.value = record.cleanliness || "Clean";
        latitudeInput.value = record.lat;
        longitudeInput.value = record.lng;
        if (leaseStartInput) leaseStartInput.value = record.lease_start_date || "";
        if (leaseExpirationInput) leaseExpirationInput.value = record.lease_expiration_date || "";
        if (ownerInput) ownerInput.value = getPlotOwnerName(record) || "Not Assigned";
        updateNameFieldRequirement(record.status);
        // live update the admin map when coordinates are changed in the form
        editingRecordId = record.id;
        latitudeInput.oninput = () => onRecordCoordinateInputChange(record.id);
        longitudeInput.oninput = () => onRecordCoordinateInputChange(record.id);
    } else if (mode === "view" && record) {
        modalTitle.textContent = "Burial Record Details";
        saveButton.textContent = "Close";
        document.getElementById("recordId").value = record.id;
        nameInput.value = record.name;
        blockInput.value = record.block;
        plotInput.value = record.plot;
        dateInput.value = normalizeDateValue(record.date);
        statusInput.value = record.status;
        cleanlinessInput.value = record.cleanliness || "Clean";
        latitudeInput.value = record.lat;
        longitudeInput.value = record.lng;
        if (leaseStartInput) leaseStartInput.value = record.lease_start_date || "";
        if (leaseExpirationInput) leaseExpirationInput.value = record.lease_expiration_date || "";
        if (ownerInput) ownerInput.value = getPlotOwnerName(record) || "Not Assigned";

        nameInput.disabled = true;
        blockInput.disabled = true;
        plotInput.disabled = true;
        dateInput.disabled = true;
        statusInput.disabled = true;
        cleanlinessInput.disabled = true;
        latitudeInput.disabled = true;
        longitudeInput.disabled = true;
        if (leaseStartInput) leaseStartInput.disabled = true;
        if (leaseExpirationInput) leaseExpirationInput.disabled = true;
        if (ownerInput) ownerInput.disabled = true;
    }

    toggleAddRecordModal(true);
}

function isValidLatitude(lat) {
    return typeof lat === 'number' && isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLongitude(lng) {
    return typeof lng === 'number' && isFinite(lng) && lng >= -180 && lng <= 180;
}

/* Block and plot are typed by hand, which is how the database ended up with
   "C" and "Block C" for the same block, and with "A - 023" next to "A-023".
   Everything is now stored as "Block X" plus "A-024", which is the same
   convention that supabase/03_data_integrity.sql applies to the old rows. */
function normalizeBlock(value) {
    const trimmed = String(value || "").trim();

    if (!trimmed) {
        return "";
    }

    return "Block " + trimmed.replace(/^block\s*/i, "");
}

function normalizePlot(value) {
    return String(value || "").replace(/\s+/g, "").trim();
}

function onRecordCoordinateInputChange(recordId) {
    if (!adminMap) return;
    const latVal = parseFloat(document.getElementById('recordLatitude').value);
    const lngVal = parseFloat(document.getElementById('recordLongitude').value);
    if (!isValidLatitude(latVal) || !isValidLongitude(lngVal)) return;

    // Update the admin focus marker so admin can preview position immediately
    if (editingRecordId && editingRecordId === recordId) {
        if (adminMarker) {
            try { adminMarker.setLatLng([latVal, lngVal]); } catch (e) {}
            adminMarker.bindPopup(`<strong>Preview</strong><br>${document.getElementById('recordName').value || ''} • ${document.getElementById('recordBlock').value || ''} • ${document.getElementById('recordPlot').value || ''}`);
        } else {
            adminMarker = L.marker([latVal, lngVal]).addTo(adminMap);
        }
        adminMap.setView([latVal, lngVal], 18);
    }
}

async function deleteBurialRecord(recordId) {
    const record = burialRecords.find((item) => item.id === recordId);
    if (!record) {
        return;
    }

    const confirmed = confirm(`Are you sure you want to remove ${record.name} (Plot ${record.plot})?`);
    if (!confirmed) {
        return;
    }

    if (!await deleteBurialRecordFromSupabase(recordId)) {
        alert("The record could not be removed. Please try again.");
        return;
    }

    burialRecords = burialRecords.filter((item) => item.id !== recordId);

    renderBurialRecordsTable();
    renderMapMarkers();
    renderRecentBurialActivity();
    filterAdminRecords(document.getElementById("adminSearchInput")?.value || "");
    toggleAddRecordModal(false);
}

async function handleAddBurialRecord(event) {
    event.preventDefault();

    const name = document.getElementById("recordName").value.trim();
    const block = normalizeBlock(document.getElementById("recordBlock").value);
    const plot = normalizePlot(document.getElementById("recordPlot").value);
    const date = document.getElementById("recordDate").value;          // already YYYY-MM-DD
    const status = document.getElementById("recordStatus").value;
    const cleanliness = document.getElementById("recordCleanliness").value;
    const latitude = parseFloat(document.getElementById("recordLatitude").value);
    const longitude = parseFloat(document.getElementById("recordLongitude").value);
    const leaseStartInput = document.getElementById("recordLeaseStart");
    const leaseExpirationInput = document.getElementById("recordLeaseExpiration");
    const leaseStartDate = leaseStartInput && leaseStartInput.value ? leaseStartInput.value : null;
    const leaseExpirationDate = leaseExpirationInput && leaseExpirationInput.value ? leaseExpirationInput.value : null;
    const saveButton = document.getElementById("saveRecordBtn");

    if (!block || !plot || !date) {
        alert("Please complete all required fields.");
        return;
    }

    if (status !== "Available" && !name) {
        alert("Please enter the deceased name when the plot is occupied or reserved.");
        return;
    }

    // coordinates used to be saved without any range check, so a swapped
    // latitude such as 120.89 could be stored
    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
        alert("Please enter a valid latitude (-90 to 90) and longitude (-180 to 180).");
        return;
    }

    // a lease cannot expire before it starts (the database enforces this too)
    if (leaseStartDate && leaseExpirationDate && leaseExpirationDate < leaseStartDate) {
        alert("The lease expiration date cannot be before the lease start date.");
        return;
    }

    // stop a double click from creating two records
    if (saveButton) {
        saveButton.disabled = true;
    }

    const recordId = document.getElementById("recordId").value;

    if (activeRecordMode === "view") {
        if (saveButton) {
            saveButton.disabled = false;
        }
        toggleAddRecordModal(false);
        resetRecordForm();
        return;
    }

    if (recordId) {
        const existingRecord = burialRecords.find((item) => item.id === recordId);
        if (existingRecord) {
            /* The same fallback the form uses, so a row with no stored condition
               cannot look like a change either. */
            const oldCondition = existingRecord.cleanliness || "Clean";
            existingRecord.name = status === "Available" ? "" : name;
            existingRecord.block = block;
            existingRecord.plot = plot;
            existingRecord.date = date;
            existingRecord.status = status;
            existingRecord.cleanliness = cleanliness;
            existingRecord.lat = latitude;
            existingRecord.lng = longitude;
            existingRecord.lease_start_date = leaseStartDate;
            existingRecord.lease_expiration_date = leaseExpirationDate;

            // update ONLY this row - never the whole table
            const saved = await updateBurialRecord({
                id: existingRecord.id,
                name: existingRecord.name,
                block: existingRecord.block,
                plot: existingRecord.plot,
                date: existingRecord.date,
                status: existingRecord.status,
                cleanliness: existingRecord.cleanliness,
                lat: existingRecord.lat,
                lng: existingRecord.lng,
                lease_start_date: existingRecord.lease_start_date,
                lease_expiration_date: existingRecord.lease_expiration_date
            });

            if (!saved) {
                if (saveButton) {
                    saveButton.disabled = false;
                }
                alert(lastRecordSaveMessage || "The record could not be saved. Check your connection and try again.");
                return;
            }

            if (oldCondition !== cleanliness) {
                await addGraveConditionNotification(existingRecord, oldCondition, cleanliness);
            }
        }
    } else {
        // the id is not sent: the database assigns it (supabase/02_record_ids.sql)
        const inserted = await insertBurialRecord({
            name: status === "Available" ? "" : name,
            block,
            plot,
            date,
            status,
            cleanliness,
            lat: latitude,
            lng: longitude,
            lease_start_date: leaseStartDate,
            lease_expiration_date: leaseExpirationDate
        });

        if (!inserted) {
            if (saveButton) {
                saveButton.disabled = false;
            }
            alert(lastRecordSaveMessage || "The record could not be saved. Check your connection and try again.");
            return;
        }

        burialRecords.unshift(inserted);
    }

    const updatedRecord = burialRecords.find((item) => item.id === recordId) || burialRecords[0];

    if (updatedRecord && adminMarker) {
        adminMarker.setLatLng([updatedRecord.lat, updatedRecord.lng]);
        adminMarker.bindPopup(`<strong>${updatedRecord.name}</strong><br>${updatedRecord.block} • Plot ${updatedRecord.plot}`);
    }

    if (updatedRecord && adminMap) {
        adminMap.setView([updatedRecord.lat, updatedRecord.lng], 16);
        if (adminMarker) {
            adminMarker.openPopup();
        }
    }

    renderBurialRecordsTable();
    renderMapMarkers();
    renderRecentBurialActivity();
    renderAdminLeaseReminders();
    filterAdminRecords(document.getElementById("adminSearchInput")?.value || "");
    resetRecordForm();
    toggleAddRecordModal(false);
    alert(activeRecordMode === "edit" ? `Burial record for ${name} updated successfully.` : `Burial record for ${name} added successfully.`);
}

function initializeBurialSearch() {
    const searchButton = document.getElementById("searchBurialBtn");
    const searchInput = document.getElementById("burialSearchInput");
    const notificationButton = document.getElementById("notificationButton");
    const navigateButton = document.getElementById("navigateToGraveBtn");

    initializeMap();
    renderRecentSearches();
    renderConditionNotifications();
    renderLeaseSummary();
    initializeProfileSidebar();

    if (searchButton) {
        searchButton.addEventListener("click", searchBurialRecord);
    }

    if (navigateButton) {
        navigateButton.addEventListener("click", navigateToSelectedGrave);
    }

    if (notificationButton) {
        notificationButton.addEventListener("click", () => {
            const notificationBadge = document.getElementById("notificationBadge");
            const leaseSection = document.getElementById("leaseReminderSection");
            const section = document.getElementById("conditionNotificationSection");
            if (notificationBadge) {
                notificationBadge.textContent = "";
                notificationBadge.style.display = "none";
            }
            // a lease that needs renewing matters more than a condition update,
            // so the bell goes there first
            const target = (getVisitorLeaseReminderItems().length > 0 && leaseSection) ? leaseSection : section;
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });
    }

    if (searchInput) {
        searchInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                searchBurialRecord();
            }
        });
    }
}

function initializeAdminDashboard() {
    initializeAdminMap();
    updateDashboardStats();
    renderAdminLeaseReminders();

    const openButton = document.getElementById("openAddRecordBtn");
    const closeButton = document.getElementById("closeAddRecordModal");
    const cancelButton = document.getElementById("cancelAddRecordBtn");
    const form = document.getElementById("addBurialRecordForm");
    const searchInput = document.getElementById("adminSearchInput");
    const notificationButton = document.getElementById("notificationButton");
    const navigateButton = document.getElementById("adminNavigateToGraveBtn");

    if (navigateButton) {
        navigateButton.addEventListener("click", navigateToSelectedAdminGrave);
    }

    if (burialRecords[0]) {
        focusAdminRecord(burialRecords[0]);
    }

    if (notificationButton) {
        notificationButton.addEventListener("click", () => {
            const notificationBadge = document.getElementById("notificationBadge");
            const activitySection = document.querySelector(".activity-section");
            if (notificationBadge) {
                notificationBadge.textContent = "";
                notificationBadge.style.display = "none";
            }
            if (activitySection) {
                activitySection.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });
    }

    if (openButton) {
        openButton.addEventListener("click", () => toggleAddRecordModal(true));
    }

    if (closeButton) {
        closeButton.addEventListener("click", () => toggleAddRecordModal(false));
    }

    if (cancelButton) {
        cancelButton.addEventListener("click", () => toggleAddRecordModal(false));
    }

    if (form) {
        form.addEventListener("submit", handleAddBurialRecord);
    }

    if (searchInput) {
        searchInput.addEventListener("input", (event) => {
            const q = event.target.value;
            filterAdminRecords(q);
            const matched = findMatchingRecord(q || "");
            if (matched) {
                focusAdminRecord(matched);
            }
        });
        searchInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                filterAdminRecords(searchInput.value);
                const matched = findMatchingRecord(searchInput.value || "");
                if (matched) focusAdminRecord(matched);
            }
        });
    }

    renderBurialRecordsTable();
    renderRecentBurialActivity();
    renderMapMarkers();
    if (typeof filterAdminRecords === "function") {
        filterAdminRecords("");
    }

    const tableBody = document.getElementById("burialRecordsTableBody");

    if (tableBody) {
        tableBody.addEventListener("click", async (event) => {
            const button = event.target.closest(".table-action-btn");

            if (!button) {
                return;
            }

            const action = button.dataset.action;
            const recordId = button.dataset.recordId;
            const record = burialRecords.find((item) => item.id === recordId);

            if (!action || !record) {
                return;
            }

            if (action === "delete") {
                await deleteBurialRecord(recordId);
                return;
            }

            openRecordModal(action, record);
        });
    }

    const leaseTableBody = document.getElementById("leaseReminderTableBody");

    if (leaseTableBody) {
        leaseTableBody.addEventListener("click", async (event) => {
            const button = event.target.closest(".table-action-btn");

            if (button && button.dataset.action === "send-lease-reminder") {
                await sendLeaseReminder(button.dataset.recordId);
            }
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            toggleAddRecordModal(false);
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    // Every page that loads this file now requires a real Supabase Auth session
    // with the role that matches the page. This is what stops someone from
    // opening admin.html directly instead of the old "?user=" URL parameter.
    const profile = await requireAccess(expectedRoleForPage());
    if (!profile) {
        return;
    }

    burialRecords = await loadBurialRecords();
    await loadReservationApplications();

    /* Lease reminders are stored in Supabase, so they follow the account to any
       device. loadPlotOwners() is for administrators only (a visitor may not
       read other people's profiles) and generateDueLeaseReminders() writes the
       single reminder the visitor's lease currently deserves - a duplicate is
       impossible because of the unique constraint on the table. */
    await loadLeaseRemindersFromSupabase();

    if (profile.role === "admin") {
        await loadPlotOwners();
    }

    await generateDueLeaseReminders();

    updateDashboardStats();
    initializeBurialSearch();
    initializeAdminDashboard();
    initializeUserReservations();
    initializeAdminReservations();
});