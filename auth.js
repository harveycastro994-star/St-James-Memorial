/* =========================================================================
   auth.js  -  ONE shared Supabase client + session helpers
   -------------------------------------------------------------------------
   Loaded by every page BEFORE script.js, in this order:

       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
       <script src="auth.js"></script>
       <script src="script.js"></script>        (only on pages that need it)

   Why this file exists:
     * the Supabase URL / publishable key used to be copy-pasted into 4 files
     * identity used to come from the "?user=" URL parameter, which allowed
       admin.html?user=admin to open the administrator dashboard with no
       password.  Identity now comes from a real Supabase Auth session and
       nothing is read from the URL.
   ========================================================================= */

const supabaseUrl = "https://ouzfgihgrlssdsqupxit.supabase.co";
const supabaseKey = "sb_publishable_WS3s-R0mWBNth37TzBdlmg_jcerNWRm";

if (!window.supabase) {
    console.error("auth.js: the Supabase library did not load - check the CDN <script> tag order.");
}

const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

/* The signed-in session and the matching public.profiles row. */
let currentSession = null;
let currentProfile = null;

/* -------------------------------------------------------------------------
   Read the current session from Supabase (it survives a page refresh).
   ------------------------------------------------------------------------- */
async function loadSession() {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
        console.warn("auth.js: unable to read the session:", error.message);
        currentSession = null;
        return null;
    }

    currentSession = data.session || null;
    return currentSession;
}

/* -------------------------------------------------------------------------
   Load the profiles row (role + assigned grave) for the signed-in user.
   Returns null when there is no session or no profile row.
   ------------------------------------------------------------------------- */
async function loadProfile() {
    if (!currentSession || !currentSession.user) {
        currentProfile = null;
        return null;
    }

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", currentSession.user.id)
        .maybeSingle();

    if (error) {
        console.warn("auth.js: unable to load the profile:", error.message);
        currentProfile = null;
        return null;
    }

    if (!data) {
        currentProfile = null;
        return null;
    }

    /* attach the visitor's assigned plot, when there is one */
    if (data.assigned_record_id) {
        const { data: record, error: recordError } = await supabaseClient
            .from("burial_records")
            .select("*")
            .eq("id", data.assigned_record_id)
            .maybeSingle();

        if (recordError) {
            console.warn("auth.js: unable to load the assigned plot:", recordError.message);
        }

        data.assigned_record = record || null;
    } else {
        data.assigned_record = null;
    }

    currentProfile = data;
    return currentProfile;
}

/* The profile that requireAccess() already loaded, without another query. */
function getCachedProfile() {
    return currentProfile;
}

function roleHomePage(role) {
    return role === "admin" ? "admin.html" : "user.html";
}

/* -------------------------------------------------------------------------
   Login / logout
   ------------------------------------------------------------------------- */
async function signInWithEmailPassword(email, password) {
    return supabaseClient.auth.signInWithPassword({
        email: String(email || "").trim(),
        password: String(password || "")
    });
}

async function signOutAndGoHome() {
    try {
        await supabaseClient.auth.signOut();
    } catch (error) {
        console.warn("auth.js: sign out failed:", error);
    }
    window.location.replace("index.html");
}

/* -------------------------------------------------------------------------
   Page guard - call this FIRST in every page's DOMContentLoaded handler.
   Returns the profile when access is allowed, or null after redirecting.
   ------------------------------------------------------------------------- */
async function requireAccess(expectedRole) {
    await loadSession();

    if (!currentSession) {
        window.location.replace("index.html");
        return null;
    }

    const profile = await loadProfile();

    if (!profile) {
        console.warn("auth.js: no profile row exists for this account.");
        await signOutAndGoHome();
        return null;
    }

    if (expectedRole && profile.role !== expectedRole) {
        /* send the user to the dashboard that matches their real role */
        window.location.replace(roleHomePage(profile.role));
        return null;
    }

    return profile;
}

/* -------------------------------------------------------------------------
   If the session expires or is signed out in another tab, go back to login.
   ------------------------------------------------------------------------- */
supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && !/index\.html$/.test(window.location.pathname)) {
        window.location.replace("index.html");
    }
});
