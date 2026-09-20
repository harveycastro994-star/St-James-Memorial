const supabaseUrl = "https://ouzfgihgrlssdsqupxit.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91emZnaWhncmxzc2RzcXVweGl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4Mzc1NTAsImV4cCI6MjEwNDQxMzU1MH0.HSOvDFT_a6N7jk4e_-xlZkXqQfyCnIYyHGS2T07s1K0";

const supabaseClient = window.supabase
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null;

function login() {

    const role = document.getElementById("role").value;
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    // Administrator
    if(role === "admin"){

        if(username === "admin" && password === "admin123"){

            window.location.href = "admin.html";

        }else{

            alert("Invalid Administrator Username or Password.");

        }

    }

    // Visitor
    else if(role === "visitor"){

        if(username === "visitor" && password === "visitor123"){

            window.location.href = "user.html";

        }else{

            alert("Invalid Visitor Username or Password.");

        }

    }

    else{

        alert("Please select a role.");

    }

}

const BURIAL_DB_KEY = "stjames.db";
const INDEXEDDB_NAME = "StJamesMemorialParkDB";
const INDEXEDDB_VERSION = 1;
const INDEXEDDB_STORE = "burial_records";
const defaultBurialRecords = [
    { id: "001", name: "Clance Yhvan Cruz", block: "Block A", plot: "A-024", date: "January 15, 2025", status: "Occupied", cleanliness: "Clean", lat: 14.5995, lng: 120.9842 },
    { id: "002", name: "Maria Elena Santos", block: "Block C", plot: "C-015", date: "February 3, 2025", status: "Occupied", cleanliness: "Dirty", lat: 14.6004, lng: 120.9831 },
    { id: "003", name: "Juan Dela Cruz", block: "Block D", plot: "D-010", date: "March 12, 2025", status: "Reserved", cleanliness: "Clean", lat: 14.5988, lng: 120.9853 },
    { id: "004", name: "Rosa B. Fernandez", block: "Block B", plot: "B-007", date: "April 18, 2025", status: "Available", cleanliness: "Dirty", lat: 14.6011, lng: 120.9860 },
    { id: "005", name: "Emilio R. Torres", block: "Block E", plot: "E-021", date: "May 5, 2025", status: "Occupied", cleanliness: "Clean", lat: 14.5979, lng: 120.9838 }
];

let burialRecords = [];
let editingRecordId = null;

function openBurialDatabase() {
    return new Promise((resolve) => {
        if (typeof window === "undefined" || !window.indexedDB) {
            resolve(null);
            return;
        }

        const request = window.indexedDB.open(INDEXEDDB_NAME, INDEXEDDB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(INDEXEDDB_STORE)) {
                db.createObjectStore(INDEXEDDB_STORE, { keyPath: "id" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            console.warn("Unable to open IndexedDB:", request.error);
            resolve(null);
        };
        request.onblocked = () => {
            console.warn("IndexedDB open blocked");
            resolve(null);
        };
    });
}

function getBurialRecordsFromDB() {
    return new Promise(async (resolve) => {
        const db = await openBurialDatabase();
        if (!db) {
            resolve(null);
            return;
        }

        const transaction = db.transaction(INDEXEDDB_STORE, "readonly");
        const store = transaction.objectStore(INDEXEDDB_STORE);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => {
            console.warn("Unable to read burial records from IndexedDB:", request.error);
            resolve(null);
        };
    });
}

function saveBurialRecordsToDB(records) {
    return new Promise(async (resolve) => {
        const db = await openBurialDatabase();
        if (!db) {
            resolve();
            return;
        }

        const transaction = db.transaction(INDEXEDDB_STORE, "readwrite");
        const store = transaction.objectStore(INDEXEDDB_STORE);

        const clearRequest = store.clear();
        clearRequest.onerror = () => console.warn("Unable to clear IndexedDB store:", clearRequest.error);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => {
            console.warn("Unable to save burial records to IndexedDB:", transaction.error);
            resolve();
        };
        transaction.onabort = () => resolve();

        records.forEach((record) => {
            store.put(record);
        });
    });
}

async function getBurialRecordsFromFile() {
    if (typeof fetch !== "function") {
        return null;
    }

    try {
        const response = await fetch("stjames.db");
        if (!response.ok) {
            return null;
        }

        const records = await response.json();
        return Array.isArray(records) ? records : null;
    } catch (error) {
        console.warn("Unable to load burial records from stjames.db:", error);
        return null;
    }
}

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

async function saveBurialRecordsToSupabase(records) {
    if (!supabaseClient) {
        return;
    }

    const { error } = await supabaseClient
        .from("burial_records")
        .upsert(records, { onConflict: "id" });

    if (error) {
        console.warn("Unable to save burial records to Supabase:", error.message);
    }
}

async function deleteBurialRecordFromSupabase(recordId) {
    if (!supabaseClient) {
        return;
    }

    const { error } = await supabaseClient
        .from("burial_records")
        .delete()
        .eq("id", recordId);

    if (error) {
        console.warn("Unable to delete burial record from Supabase:", error.message);
    }
}

function downloadBurialDatabaseFile() {
    const blob = new Blob([JSON.stringify(burialRecords, null, 4)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "stjames.db";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

async function loadBurialRecords() {
    try {
        const supabaseRecords = await getBurialRecordsFromSupabase();
        if (Array.isArray(supabaseRecords) && supabaseRecords.length > 0) {
            await saveBurialRecordsToDB(supabaseRecords);
            localStorage.setItem(BURIAL_DB_KEY, JSON.stringify(supabaseRecords));
            return supabaseRecords;
        }

        const dbRecords = await getBurialRecordsFromDB();
        if (Array.isArray(dbRecords) && dbRecords.length > 0) {
            return dbRecords;
        }

        const storedRecords = JSON.parse(localStorage.getItem(BURIAL_DB_KEY) || "null");
        if (Array.isArray(storedRecords) && storedRecords.length > 0) {
            await saveBurialRecordsToDB(storedRecords);
            return storedRecords;
        }

        const fileRecords = await getBurialRecordsFromFile();
        if (Array.isArray(fileRecords) && fileRecords.length > 0) {
            await saveBurialRecordsToDB(fileRecords);
            try {
                localStorage.setItem(BURIAL_DB_KEY, JSON.stringify(fileRecords));
            } catch (error) {
                console.warn("Unable to save file-based records to localStorage:", error);
            }
            return fileRecords;
        }

        await saveBurialRecordsToDB(defaultBurialRecords);
        try {
            localStorage.setItem(BURIAL_DB_KEY, JSON.stringify(defaultBurialRecords));
        } catch (error) {
            console.warn("Unable to save default burial records to localStorage:", error);
        }
    } catch (error) {
        console.warn("Unable to load burial records:", error);
    }

    return defaultBurialRecords;
}

async function saveBurialRecords() {
    try {
        localStorage.setItem(BURIAL_DB_KEY, JSON.stringify(burialRecords));
    } catch (error) {
        console.warn("Unable to save burial records to localStorage:", error);
    }

    await saveBurialRecordsToDB(burialRecords);
    await saveBurialRecordsToSupabase(burialRecords);
}

const RECENT_SEARCHES_KEY = "recentBurialSearches";
const GRAVE_CONDITION_NOTIFICATIONS_KEY = "graveConditionNotifications";
const CURRENT_USER_KEY = "stjamesCurrentUser";
const RECENT_BURIAL_ACTIVITY_KEY = "recentBurialActivityLog";
const MAX_RECENT_ITEMS = 5;
const RESERVATION_APPLICATIONS_KEY = "stjamesReservationApplications";
let reservationApplications = [];
let cemeteryMap = null;
let currentMarker = null;
let userGpsMarker = null;
let selectedBurialRecord = null;
let navigationRouteLayer = null;
let selectedAdminBurialRecord = null;
let adminNavigationRouteLayer = null;
let adminMap = null;
let adminMarker = null;
let adminGpsMarker = null;
let cemeteryMarkersLayer = null;
let adminMarkersLayer = null;
let cemeteryLocationMarker = null;
let activeRecordMode = "add";
const PLARIDEL_CEMETERY_COORDINATES = [14.8830, 120.8614];

function getReservationApplications() {
    try {
        const saved = JSON.parse(localStorage.getItem(RESERVATION_APPLICATIONS_KEY) || "[]");
        return Array.isArray(saved) ? saved : [];
    } catch (error) {
        console.warn("Unable to load reservation applications:", error);
        return [];
    }
}

function saveReservationApplicationsToStorage() {
    localStorage.setItem(RESERVATION_APPLICATIONS_KEY, JSON.stringify(reservationApplications));
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
            saveReservationApplicationsToStorage();
            return;
        }

        if (error) {
            console.warn("Unable to load reservation applications from Supabase:", error.message);
        }
    }

    reservationApplications = getReservationApplications();
}

async function saveReservationApplication(application) {
    reservationApplications = [application, ...reservationApplications.filter((item) => item.recordId !== application.recordId)];
    saveReservationApplicationsToStorage();

    if (!supabaseClient) {
        return true;
    }

    const { error } = await supabaseClient
        .from("reservation_applications")
        .upsert({
            id: application.id,
            record_id: application.recordId,
            applicant_full_name: application.applicantFullName,
            applicant_email: application.applicantEmail,
            applicant_contact_number: application.applicantContactNumber,
            deceased_full_name: application.deceasedFullName,
            deceased_date_of_birth: application.deceasedDateOfBirth,
            deceased_date_of_death: application.deceasedDateOfDeath,
            preferred_burial_date: application.preferredBurialDate,
            status: application.status,
            created_at: application.createdAt
        }, { onConflict: "id" });

    if (error) {
        console.warn("Unable to save reservation application to Supabase:", error.message);
        return false;
    }

    return true;
}

function getReservationApplication(recordId) {
    return reservationApplications.find((application) => application.recordId === recordId);
}

async function updateReservationApplicationStatus(application, status) {
    application.status = status;
    reservationApplications = reservationApplications.map((item) => item.id === application.id ? application : item);
    saveReservationApplicationsToStorage();

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

function getRecentSearches() {
    try {
        const searches = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || "[]");
        return Array.isArray(searches) ? searches.slice(0, MAX_RECENT_ITEMS) : [];
    } catch (error) {
        return [];
    }
}

function saveRecentSearches(searches) {
    try {
        const limitedSearches = Array.isArray(searches) ? searches.slice(0, MAX_RECENT_ITEMS) : [];
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(limitedSearches));
    } catch (error) {
        console.warn("Unable to save recent searches:", error);
    }
}

function getGraveConditionNotifications() {
    try {
        const notifications = JSON.parse(localStorage.getItem(GRAVE_CONDITION_NOTIFICATIONS_KEY) || "[]");
        return Array.isArray(notifications) ? notifications.slice(0, MAX_RECENT_ITEMS) : [];
    } catch (error) {
        console.warn("Unable to load grave condition notifications:", error);
        return [];
    }
}

function saveGraveConditionNotifications(notifications) {
    try {
        const limitedNotifications = Array.isArray(notifications) ? notifications.slice(0, MAX_RECENT_ITEMS) : [];
        localStorage.setItem(GRAVE_CONDITION_NOTIFICATIONS_KEY, JSON.stringify(limitedNotifications));
    } catch (error) {
        console.warn("Unable to save grave condition notifications:", error);
    }
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
    const notifications = getGraveConditionNotifications();
    const notification = {
        id: `${record.id}-${Date.now()}`,
        name: record.name,
        block: record.block,
        plot: record.plot,
        oldCondition,
        newCondition,
        timestamp: Date.now(),
    };

    const updatedNotifications = [notification, ...notifications].slice(0, MAX_RECENT_ITEMS);
    saveGraveConditionNotifications(updatedNotifications);
    await saveGraveConditionNotificationToSupabase(notification);
}

function getCurrentUser() {
    try {
        return JSON.parse(sessionStorage.getItem(CURRENT_USER_KEY) || "null");
    } catch (error) {
        return null;
    }
}

function notificationBelongsToCurrentUser(notification) {
    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.role !== "visitor" || !currentUser.grave) {
        return currentUser?.role !== "visitor";
    }

    return notification.block === currentUser.grave.block
        && notification.plot === currentUser.grave.plot;
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
    const count = notifications.length;

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
    dateElement.textContent = record.date;
    statusElement.textContent = record.status;

    if (record.lat !== undefined && record.lng !== undefined) {
        focusBurialOnMap(record);
    }
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
        renderBurialMarkers(cemeteryMap, cemeteryMarkersLayer, burialRecords);
    }

    if (adminMap) {
        if (!adminMarkersLayer) {
            adminMarkersLayer = L.layerGroup().addTo(adminMap);
        }
        renderBurialMarkers(adminMap, adminMarkersLayer, burialRecords);
    }
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
    focusBurialOnMap(burialRecords[0]);

    const locationButton = document.getElementById("useUserCurrentLocationBtn");
    const accuracyElement = document.getElementById("userGpsAccuracy");
    if (locationButton) {
        locationButton.addEventListener("click", () => {
            if (!navigator.geolocation) {
                if (accuracyElement) accuracyElement.textContent = "GPS is not available in this browser.";
                return;
            }

            locationButton.disabled = true;
            locationButton.textContent = "Finding location...";

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const latitude = position.coords.latitude;
                    const longitude = position.coords.longitude;
                    const accuracy = position.coords.accuracy;

                    if (userGpsMarker) {
                        userGpsMarker.setLatLng([latitude, longitude]);
                    } else {
                        userGpsMarker = L.marker([latitude, longitude])
                            .addTo(cemeteryMap)
                            .bindPopup("Device GPS location");
                    }

                    cemeteryMap.setView([latitude, longitude], 20);

                    const userLatitudeElement = document.getElementById("userLatitude");
                    const userLongitudeElement = document.getElementById("userLongitude");
                    if (userLatitudeElement) userLatitudeElement.textContent = latitude.toFixed(6);
                    if (userLongitudeElement) userLongitudeElement.textContent = longitude.toFixed(6);

                    if (accuracyElement) accuracyElement.textContent = `Estimated GPS accuracy: ${Math.round(accuracy)} meters`;
                    locationButton.disabled = false;
                    locationButton.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Use My GPS Location';
                },
                (error) => {
                    if (accuracyElement) accuracyElement.textContent = `Unable to get location: ${error.message}`;
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

            locationButton.disabled = true;
            locationButton.textContent = "Finding location...";

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const latitude = position.coords.latitude;
                    const longitude = position.coords.longitude;
                    const accuracy = position.coords.accuracy;

                    if (adminGpsMarker) {
                        adminGpsMarker.setLatLng([latitude, longitude]);
                    } else {
                        adminGpsMarker = L.marker([latitude, longitude])
                            .addTo(adminMap)
                            .bindPopup("Device GPS location");
                    }

                    adminMap.setView([latitude, longitude], 20);
                    const latitudeElement = document.getElementById("adminLatitude");
                    const longitudeElement = document.getElementById("adminLongitude");
                    if (latitudeElement) latitudeElement.textContent = latitude;
                    if (longitudeElement) longitudeElement.textContent = longitude;
                    if (accuracyElement) accuracyElement.textContent = `Estimated GPS accuracy: ${Math.round(accuracy)} meters`;

                    locationButton.disabled = false;
                    locationButton.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Use My GPS Location';
                },
                (error) => {
                    if (accuracyElement) accuracyElement.textContent = `Unable to get location: ${error.message}`;
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
    if (burialDateElement) burialDateElement.textContent = record.date || "-";
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
        const fullName = record.name.toLowerCase();
        const block = record.block.toLowerCase();
        const plot = record.plot.toLowerCase();
        return fullName === searchTerm || block === searchTerm || plot === searchTerm || fullName.includes(searchTerm) || block.includes(searchTerm) || plot.includes(searchTerm);
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
        const isMatch = !query || rowName === query || rowBlock === query || rowPlot === query || rowName.includes(query) || rowBlock.includes(query) || rowPlot.includes(query);

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

    navigator.geolocation.getCurrentPosition(async (position) => {
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
            const response = await fetch(routeUrl);
            const routeData = await response.json();
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
    }, (error) => {
        if (statusElement) statusElement.textContent = `Unable to get location: ${error.message}`;
        if (navigateButton) {
            navigateButton.disabled = false;
            navigateButton.innerHTML = '<i class="fa-solid fa-route"></i> Navigate to Grave';
        }
    }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
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

    navigator.geolocation.getCurrentPosition(async (position) => {
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
            const response = await fetch(routeUrl);
            const routeData = await response.json();
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
    }, (error) => {
        if (statusElement) statusElement.textContent = `Unable to get location: ${error.message}`;
        if (navigateButton) {
            navigateButton.disabled = false;
            navigateButton.innerHTML = '<i class="fa-solid fa-route"></i> Navigate to Grave';
        }
    }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
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

function getRecentBurialActivity() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_BURIAL_ACTIVITY_KEY) || "[]");
    } catch (error) {
        console.warn("Unable to load recent burial activity:", error);
        return [];
    }
}

function saveRecentBurialActivity(activityItems) {
    try {
        localStorage.setItem(RECENT_BURIAL_ACTIVITY_KEY, JSON.stringify(activityItems));
    } catch (error) {
        console.warn("Unable to save recent burial activity:", error);
    }
}

function addRecentBurialActivity(activity) {
    const activities = getRecentBurialActivity();
    const nextActivity = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        icon: activity.icon || "fa-solid fa-clock-rotate-left",
        title: activity.title || "Burial Record Updated",
        description: activity.description || "Burial record was updated.",
        timestamp: activity.timestamp || Date.now()
    };

    const updatedActivities = [nextActivity, ...activities].slice(0, 8);
    saveRecentBurialActivity(updatedActivities);
    renderRecentBurialActivity();
}

function renderRecentBurialActivity() {
    const activityList = document.getElementById("recentBurialActivityList");
    const notificationBadge = document.getElementById("notificationBadge");
    const notificationButton = document.getElementById("notificationButton");

    if (!activityList) {
        return;
    }

    const activities = getRecentBurialActivity();

    if (notificationBadge) {
        const count = activities.length;
        notificationBadge.textContent = count > 0 ? count : "";
        notificationBadge.style.display = count > 0 ? "inline-flex" : "none";
    }

    if (notificationButton) {
        notificationButton.title = activities.length > 0 ? `${activities.length} recent updates` : "No recent updates";
    }

    if (activities.length === 0) {
        activityList.innerHTML = '<div class="activity"><p>No recent activity yet.</p></div>';
        return;
    }

    activityList.innerHTML = activities.map((activity) => `
        <div class="activity">
            <i class="${activity.icon}"></i>
            <div>
                <h4>${activity.title}</h4>
                <p>${activity.description}</p>
            </div>
            <span>${formatRelativeActivityTime(activity.timestamp)}</span>
        </div>
    `).join("");
}

function renderBurialRecordsTable() {
    const tableBody = document.getElementById("burialRecordsTableBody");
    renderMapMarkers();

    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = burialRecords.map((record) => `
        <tr data-name="${record.name}" data-block="${record.block}" data-plot="${record.plot}">
            <td>${record.id}</td>
            <td>${record.name}</td>
            <td>${record.block.replace("Block ", "")}</td>
            <td>${record.plot}</td>
            <td>${record.date}</td>
            <td><span class="status ${record.status.toLowerCase()}">${record.status}</span></td>
            <td>
                <button class="table-action-btn" data-action="edit" data-record-id="${record.id}">Edit</button>
                <button class="table-action-btn" data-action="view" data-record-id="${record.id}">View</button>
                <button class="table-action-btn delete-btn" data-action="delete" data-record-id="${record.id}">Remove</button>
            </td>
        </tr>
    `).join("");

    updateDashboardStats();
}

function getReservationCounts() {
    return {
        reserved: burialRecords.filter((record) => record.status === "Reserved").length,
        available: burialRecords.filter((record) => record.status === "Available").length,
        occupied: burialRecords.filter((record) => record.status === "Occupied").length,
    };
}

function updateUserReservationStats() {
    const counts = getReservationCounts();
    const reservedCount = document.getElementById("userReservedCount");
    const availableCount = document.getElementById("userAvailableCount");
    const occupiedCount = document.getElementById("userOccupiedCount");
    const reservedCard = reservedCount?.closest(".stat-card");
    const occupiedCard = occupiedCount?.closest(".stat-card");
    const availableCard = availableCount?.closest(".stat-card");

    if (reservedCount) {
        reservedCount.textContent = "0";
    }
    if (occupiedCount) {
        occupiedCount.textContent = "0";
    }
    if (availableCount) {
        availableCount.textContent = counts.available.toString();
    }

    if (reservedCard) {
        reservedCard.style.display = "none";
    }
    if (occupiedCard) {
        occupiedCard.style.display = "none";
    }
    if (availableCard) {
        availableCard.style.display = "flex";
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
        tableBody.innerHTML = availableRecords.map((record) => `
            <tr data-name="${record.name}" data-block="${record.block}" data-plot="${record.plot}">
                <td>${record.id}</td>
                <td>${getDisplayName(record)}</td>
                <td>${record.block.replace("Block ", "")}</td>
                <td>${record.plot}</td>
                <td><span class="status ${record.status.toLowerCase()}">${record.status}</span></td>
                <td>
                    <button class="table-action-btn" data-action="reservation" data-reservation-status="available" data-record-id="${record.id}">
                        Reserve
                    </button>
                </td>
            </tr>
        `).join("");
    }

    updateUserReservationStats();
}

function renderAdminReservations() {
    const tableBody = document.getElementById("reservationsAdminTableBody");
    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = burialRecords.map((record) => `
        <tr data-name="${record.name}" data-block="${record.block}" data-plot="${record.plot}">
            <td>${record.id}</td>
            <td>${getDisplayName(record)}</td>
            <td>${record.block.replace("Block ", "")}</td>
            <td>${record.plot}</td>
            <td><span class="status ${record.status.toLowerCase()}">${record.status}</span></td>
            <td>
                ${record.status === "Reserved" && getReservationApplication(record.id) ? `<button class="table-action-btn" data-action="view-application" data-record-id="${record.id}">View Application</button>` : ""}
                <button class="table-action-btn" data-action="toggle-reservation" data-reservation-status="${record.status.toLowerCase()}" data-record-id="${record.id}">
                    ${record.status === "Reserved" ? "Release" : record.status === "Available" ? "Reserve" : "Locked"}
                </button>
            </td>
        </tr>
    `).join("");

    updateAdminReservationStats();
}

async function changeReservationStatus(recordId, newStatus) {
    const record = burialRecords.find((item) => item.id === recordId);
    if (!record) {
        return;
    }

    record.status = newStatus;
    await saveBurialRecords();
    renderMapMarkers();
    renderUserReservations();
    renderAdminReservations();
    updateDashboardStats();
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

async function submitReservationApplication(event) {
    event.preventDefault();
    const form = event.target;
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

    const application = {
        id: `${recordId}-${Date.now()}`,
        recordId,
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

    record.name = application.deceasedFullName;
    record.status = "Reserved";
    await saveReservationApplication(application);
    await saveBurialRecords();
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
    if (status === "Rejected") {
        const record = burialRecords.find((item) => item.id === application.recordId);
        if (record) {
            record.status = "Available";
            record.name = "";
            await saveBurialRecords();
        }
    }
    closeReviewApplicationModal();
    renderAdminReservations();
    renderUserReservations();
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
    } else if (record.status === "Available") {
        record.status = "Reserved";
    } else {
        alert("Occupied plots cannot be reserved or released.");
        return;
    }

    await saveBurialRecords();
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

    document.getElementById("recordId").value = "";
    nameInput.value = "";
    blockInput.value = "";
    plotInput.value = "";
    dateInput.value = activeRecordMode === "edit" ? "" : getPhilippineDate();
    statusInput.value = "Occupied";
    cleanlinessInput.value = "Clean";
    latitudeInput.value = 14.954621;
    longitudeInput.value = 120.896542;
    document.getElementById("recordModalTitle").textContent = "Add Burial Record";
    document.getElementById("saveRecordBtn").textContent = "Save Record";

    nameInput.disabled = false;
    blockInput.disabled = false;
    plotInput.disabled = false;
    dateInput.disabled = false;
    statusInput.disabled = false;
    cleanlinessInput.disabled = false;
    latitudeInput.disabled = false;
    longitudeInput.disabled = false;
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
        latitudeInput.value = record.lat;
        longitudeInput.value = record.lng;
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

        nameInput.disabled = true;
        blockInput.disabled = true;
        plotInput.disabled = true;
        dateInput.disabled = true;
        statusInput.disabled = true;
        cleanlinessInput.disabled = true;
        latitudeInput.disabled = true;
        longitudeInput.disabled = true;
    }

    toggleAddRecordModal(true);
}

function isValidLatitude(lat) {
    return typeof lat === 'number' && isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLongitude(lng) {
    return typeof lng === 'number' && isFinite(lng) && lng >= -180 && lng <= 180;
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

    burialRecords = burialRecords.filter((item) => item.id !== recordId);
    await saveBurialRecords();
    await deleteBurialRecordFromSupabase(recordId);

    addRecentBurialActivity({
        icon: "fa-solid fa-trash-can",
        title: "Burial Record Removed",
        description: `${record.name} • ${record.block} • Plot ${record.plot}`
    });

    renderBurialRecordsTable();
    renderMapMarkers();
    filterAdminRecords(document.getElementById("adminSearchInput")?.value || "");
    toggleAddRecordModal(false);
}

async function handleAddBurialRecord(event) {
    event.preventDefault();

    const name = document.getElementById("recordName").value.trim();
    const block = document.getElementById("recordBlock").value.trim();
    const plot = document.getElementById("recordPlot").value.trim();
    const date = document.getElementById("recordDate").value;
    const status = document.getElementById("recordStatus").value;
    const cleanliness = document.getElementById("recordCleanliness").value;
    const latitude = parseFloat(document.getElementById("recordLatitude").value);
    const longitude = parseFloat(document.getElementById("recordLongitude").value);

    if (!block || !plot || !date) {
        alert("Please complete all required fields.");
        return;
    }

    if (status !== "Available" && !name) {
        alert("Please enter the deceased name when the plot is occupied or reserved.");
        return;
    }

    const recordId = document.getElementById("recordId").value;

    if (activeRecordMode === "view") {
        toggleAddRecordModal(false);
        resetRecordForm();
        return;
    }

    if (recordId) {
        const existingRecord = burialRecords.find((item) => item.id === recordId);
        if (existingRecord) {
            const oldCondition = existingRecord.cleanliness;
            existingRecord.name = status === "Available" ? "" : name;
            existingRecord.block = block;
            existingRecord.plot = plot;
            existingRecord.date = formatDisplayDate(date);
            existingRecord.status = status;
            existingRecord.cleanliness = cleanliness;
            if (!Number.isNaN(latitude) && !Number.isNaN(longitude)) {
                existingRecord.lat = latitude;
                existingRecord.lng = longitude;
            }

            if (oldCondition !== cleanliness) {
                await addGraveConditionNotification(existingRecord, oldCondition, cleanliness);
            }
        }
    } else {
        burialRecords.unshift({
            id: `00${burialRecords.length + 1}`,
            name: status === "Available" ? "" : name,
            block,
            plot,
            date: formatDisplayDate(date),
            status,
            cleanliness,
            lat: !Number.isNaN(latitude) ? latitude : 14.954621,
            lng: !Number.isNaN(longitude) ? longitude : 120.896542
        });
    }

    await saveBurialRecords();

    const updatedRecord = burialRecords.find((item) => item.id === recordId) || burialRecords[0];

    if (updatedRecord) {
        addRecentBurialActivity({
            icon: activeRecordMode === "edit" ? "fa-solid fa-pen" : "fa-solid fa-user-plus",
            title: activeRecordMode === "edit" ? "Burial Record Updated" : "New Burial Record Added",
            description: `${updatedRecord.name || "Available Plot"} • ${updatedRecord.block} • Plot ${updatedRecord.plot}`
        });
    }

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
    const initialRecord = burialRecords[0];
    if (initialRecord) {
        updateBurialDetails(initialRecord);
    }
    renderRecentSearches();
    renderConditionNotifications();

    if (searchButton) {
        searchButton.addEventListener("click", searchBurialRecord);
    }

    if (navigateButton) {
        navigateButton.addEventListener("click", navigateToSelectedGrave);
    }

    if (notificationButton) {
        notificationButton.addEventListener("click", () => {
            const notificationBadge = document.getElementById("notificationBadge");
            const section = document.getElementById("conditionNotificationSection");
            if (notificationBadge) {
                notificationBadge.textContent = "";
                notificationBadge.style.display = "none";
            }
            if (section) {
                section.scrollIntoView({ behavior: "smooth", block: "start" });
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

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            toggleAddRecordModal(false);
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    burialRecords = await loadBurialRecords();
    await loadReservationApplications();
    updateDashboardStats();
    initializeBurialSearch();
    initializeAdminDashboard();
    initializeUserReservations();
    initializeAdminReservations();
});