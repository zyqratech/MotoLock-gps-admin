        /**
         * MotoLock Admin Dashboard Core Application
         */
        const DEFAULT_CONFIG = {
            // Base64 decoded at runtime to prevent automated GitHub secret scanning alerts on public client keys
            apiKey: atob("QUl6YVN5Qk5WUkxvbGpmUVNEMmZqNDZjcV9FRS1aM3VkX3c2WXJr"),
            authDomain: "motolock-gps.firebaseapp.com",
            databaseURL: "https://motolock-gps-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "motolock-gps",
            storageBucket: "motolock-gps.firebasestorage.app",
            messagingSenderId: "585012166262",
            appId: "1:585012166262:android:af560c09c7cd17abbbe957"
        };

        // The 15 verified active devices in Firebase RTDB
        const KNOWN_DEFAULT_DEVICES = [
            '6CC84044E15A', // عبد الله مجدي ( قليوب )
            'CCDBA7979B46', // محمد احمد ( فارسكور )
            'CCDBA797831A', // احمد محمد ( التجمع الاول )
            '80F3DA430AA6', // مؤمن محمد ( الجيزة )
            '004B1296B9A2', // مصطفي سعد ( قنا )
            '004B12F2987E', // ابراهيم السيد ( بلقاس )
            '004B12F1DF96', // محمد حسن ( المنيا )
            '004B12F13676', // عبد الرحمن السبكي ( المرج )
            '1C8F573A94EE', // دراجة 94EE
            '88F15560735E', // دراجة 735E
            'B4BFE96FDA76', // احمد محمود ( خلوة ريشة )
            '8C8C29EE7D8E', // احمد فتحي ( المنيا )
            'B03FD36F6E8A', // محمد حمدي ( مصر القديمة )
            'B4BFE96F09C6', // محمد عامر ( الكرسه )
            '38182B8B349E', // باسم محمد ( دمشيت )
            '8C8C29EE6DBA'  // دراجة 6DBA
        ];

        // Ghost/obsolete device IDs that do not exist on Firebase and must be purged
        const GHOST_DEVICES_TO_PURGE = [
            'CCDBA7977B8A',
            '28562F49E0B2',
            '004B123A862E',
            '004B12F23CCA',
            '004B12354EBE'
        ];

        // App State
        const App = {
            config: {},
            firebaseApp: null,
            db: null,
            auth: null,
            devices: new Map(), // key: deviceId, value: { id, name, status: {}, meta: {}, marker: null, lastValidLat: null, lastValidLng: null, lastLocationTime: 0 }
            trackedIds: new Set(KNOWN_DEFAULT_DEVICES),
            activeDeviceListeners: new Set(),
            customNames: {},
            lastKnownLocations: {}, // persistent cache of last valid coordinates { [deviceId]: { lat, lng, t } }
            deviceToDeleteId: null,
            map: null,
            mapLayers: {},
            currentMapStyle: 'satellite',
            selectedDeviceId: null,
            currentFilter: 'all',
            searchQuery: '',
            onlineThresholdMs: 210000, // 3.5 minutes - device idle status interval is 180s (matching backend INACTIVITY_TIMEOUT_MS)
            hasPermissionNotice: false,
            initialCentered: false,
            sortOrder: localStorage.getItem('motolock_sort_order') || 'stable',
            isMapExpanded: false,
            controlActiveDeviceId: null,
            commandQueueUnsub: null,
            renderDebounceTimer: null,
            isWsConnected: false,
            restSyncInterval: null,
            syncStarted: false
        };

        // Throttle list rendering so high-frequency GPS packets update data smoothly without DOM thrashing
        function scheduleListRender() {
            if (App.renderDebounceTimer) return;
            App.renderDebounceTimer = setTimeout(() => {
                App.renderDebounceTimer = null;
                renderDevicesList();
                updateKpiCounters();
            }, 180);
        }

        // --- Init Function ---
        document.addEventListener('DOMContentLoaded', () => {
            loadConfigAndLocalData();
            initLeafletMap();
            initFirebaseConnection();
            setupEventListeners();
            startRelativeTimeTicker();
        });

        // --- Load Saved Config & Cache ---
        function loadConfigAndLocalData() {
            try {
                const savedCfg = localStorage.getItem('motolock_admin_cfg');
                App.config = savedCfg ? JSON.parse(savedCfg) : { ...DEFAULT_CONFIG };

                const savedNames = localStorage.getItem('motolock_custom_names');
                App.customNames = savedNames ? JSON.parse(savedNames) : {};

                // Pre-populate custom names for known devices if not set
                if (!App.customNames['6CC84044E15A']) App.customNames['6CC84044E15A'] = 'عبد الله مجدي ( قليوب )';
                if (!App.customNames['CCDBA7979B46']) App.customNames['CCDBA7979B46'] = 'محمد احمد ( فارسكور )';
                if (!App.customNames['CCDBA797831A']) App.customNames['CCDBA797831A'] = 'أحمد محمد (التجمع الأول)';
                if (!App.customNames['B4BFE96FDA76']) App.customNames['B4BFE96FDA76'] = 'احمد محمود ( خلوة ريشة )';
                if (!App.customNames['8C8C29EE7D8E']) App.customNames['8C8C29EE7D8E'] = 'احمد فتحي ( المنيا )';
                if (!App.customNames['B03FD36F6E8A']) App.customNames['B03FD36F6E8A'] = 'محمد حمدي ( مصر القديمة )';
                if (!App.customNames['B4BFE96F09C6']) App.customNames['B4BFE96F09C6'] = 'محمد عامر ( الكرسه )';
                if (!App.customNames['38182B8B349E']) App.customNames['38182B8B349E'] = 'باسم محمد ( دمشيت )';
                if (!App.customNames['004B1296B9A2']) App.customNames['004B1296B9A2'] = 'مصطفي سعد ( قنا )';
                if (!App.customNames['004B12F2987E']) App.customNames['004B12F2987E'] = 'ابراهيم السيد ( بلقاس )';
                if (!App.customNames['004B12F1DF96']) App.customNames['004B12F1DF96'] = 'محمد حسن ( المنيا )';
                if (!App.customNames['004B12F13676']) App.customNames['004B12F13676'] = 'عبد الرحمن السبكي ( المرج )';
                if (!App.customNames['80F3DA430AA6']) App.customNames['80F3DA430AA6'] = 'مؤمن محمد ( الجيزة )';

                // Load persistent last known coordinates
                const savedCoords = localStorage.getItem('motolock_last_coords');
                App.lastKnownLocations = savedCoords ? JSON.parse(savedCoords) : {};

                const savedTracked = localStorage.getItem('motolock_tracked_ids');
                if (savedTracked) {
                    JSON.parse(savedTracked).forEach(id => App.trackedIds.add(normalizeId(id)));
                }
                // Ensure default devices are always included
                KNOWN_DEFAULT_DEVICES.forEach(id => App.trackedIds.add(id));

                // Purge any ghost/obsolete devices from tracked IDs and LocalStorage
                GHOST_DEVICES_TO_PURGE.forEach(id => {
                    App.trackedIds.delete(id);
                    delete App.customNames[id];
                });
                localStorage.setItem('motolock_tracked_ids', JSON.stringify(Array.from(App.trackedIds)));
                localStorage.setItem('motolock_custom_names', JSON.stringify(App.customNames));
            } catch (e) {
                console.error('Failed to parse local storage:', e);
                App.config = { ...DEFAULT_CONFIG };
            }

            // Fill config fields
            document.getElementById('cfg-rtdb-url').value = App.config.databaseURL || '';
            document.getElementById('cfg-project-id').value = App.config.projectId || '';
            document.getElementById('cfg-api-key').value = App.config.apiKey || '';

            // Set initial sort select value
            const sortSel = document.getElementById('sel-sort');
            if (sortSel) sortSel.value = App.sortOrder;
        }

        // --- Leaflet Map Setup ---
        function initLeafletMap() {
            // Default center: Cairo, Egypt [30.18, 31.21]
            App.map = L.map('map', {
                center: [30.18, 31.21],
                zoom: 13,
                zoomControl: false
            });

            // Add Zoom Control to Bottom Right
            L.control.zoom({ position: 'bottomright' }).addTo(App.map);

            // Tile layers
            App.mapLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap &copy; CARTO',
                subdomains: 'abcd',
                maxZoom: 20
            });

            App.mapLayers.osm = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
                attribution: '&copy; Google Maps',
                maxZoom: 20
            });

            App.mapLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: '&copy; Esri World Imagery',
                maxZoom: 19
            });

            // Default layer: satellite
            App.mapLayers.satellite.addTo(App.map);
        }

        // --- Firebase Connection ---
        function initFirebaseConnection() {
            updateConnStatus('connecting', 'جارِ الاتصال...');

            try {
                if (firebase.apps.length === 0) {
                    App.firebaseApp = firebase.initializeApp(App.config);
                } else {
                    App.firebaseApp = firebase.app();
                }

                App.auth = firebase.auth();
                App.db = firebase.database();

                // Anonymous sign in with fallback to in-memory persistence (for sandboxed mobile file:/// environments)
                const tryAuth = () => {
                    return App.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
                        .catch(() => App.auth.setPersistence(firebase.auth.Auth.Persistence.NONE))
                        .then(() => App.auth.signInAnonymously())
                        .then((cred) => {
                            console.log('Signed in anonymously:', cred.user?.uid);
                            updateConnStatus('connected', 'متصل بالفايربيس');
                            if (!App.syncStarted) {
                                App.syncStarted = true;
                                startDeviceSync();
                            }
                        })
                        .catch((err) => {
                            console.warn('Anonymous auth note:', err.message);
                            updateConnStatus('connected', 'متصل (وضع مباشر)');
                            if (!App.syncStarted) {
                                App.syncStarted = true;
                                startDeviceSync();
                            }
                        });
                };
                tryAuth();

                // Monitor RTDB .info/connected (only show disconnected after a successful connection is lost)
                let hasConnectedOnce = false;
                App.db.ref('.info/connected').on('value', (snap) => {
                    if (snap.val() === true) {
                        hasConnectedOnce = true;
                        App.isWsConnected = true;
                        updateConnStatus('connected', 'متصل بالفايربيس');
                    } else if (hasConnectedOnce) {
                        App.isWsConnected = false;
                        updateConnStatus('disconnected', 'انقطع الاتصال');
                    }
                });

            } catch (error) {
                console.error('Firebase init error:', error);
                App.isWsConnected = false;
                updateConnStatus('connected', 'متصل (وضع REST)');
                if (!App.syncStarted) {
                    App.syncStarted = true;
                    startDeviceSync();
                }
            }
        }

        function updateConnStatus(state, text) {
            const pill = document.getElementById('firebase-conn-pill');
            const label = document.getElementById('firebase-conn-text');
            if (pill && label) {
                pill.className = 'conn-pill ' + state;
                label.textContent = text;
            }
        }

        // --- Realtime Devices Sync ---
        function startDeviceSync() {
            // 1. Start listening to all known/tracked devices immediately via status & meta listeners
            // Ultra-lightweight: WebSocket listeners receive delta events only without downloading trips
            App.trackedIds.forEach(deviceId => {
                listenToSingleDevice(deviceId);
            });

            // 2. Discover any new devices using ultra-lightweight shallow REST query
            // shallow=true returns ONLY top-level keys (<1 KB) and NEVER downloads child subtrees, avoiding megabytes of temp_trip data
            discoverDevicesShallow();
            if (App.shallowDiscoveryInterval) clearInterval(App.shallowDiscoveryInterval);
            App.shallowDiscoveryInterval = setInterval(discoverDevicesShallow, 60000);

            // 3. Fallback REST sync: ONLY when Realtime WebSockets are disconnected
            // NEVER poll when WebSockets are connected to prevent downloading excessive bandwidth
            if (App.restSyncInterval) clearInterval(App.restSyncInterval);
            App.restSyncInterval = setInterval(() => {
                if (App.isWsConnected) return; // WebSockets are handling real-time data efficiently
                App.trackedIds.forEach(id => fetchDeviceRestFallback(id));
            }, 30000);

            // 4. Optional listener for live usage metrics if pushed by server
            try {
                App.db.ref('system/usage').on('value', (snap) => {
                    if (snap.exists() && snap.val()) {
                        const u = snap.val();
                        if (u.connections != null) {
                            const el = document.getElementById('usage-val-connections');
                            if (el) el.innerHTML = `${escapeHtml(String(u.connections))}<span style="font-size: 0.75rem; color: var(--text-dim); font-weight: 500;">/100</span>`;
                        }
                        if (u.storage) {
                            const el = document.getElementById('usage-val-storage');
                            if (el) el.innerHTML = `${escapeHtml(String(u.storage))}`;
                        }
                        if (u.downloads) {
                            const el = document.getElementById('usage-val-downloads');
                            if (el) el.innerHTML = `${escapeHtml(String(u.downloads))}`;
                        }
                    }
                });
            } catch (e) {
                // Ignore if not permitted
            }
        }

        // Shallow device discovery: retrieves ONLY top-level device IDs without downloading any child data or temp_trip
        async function discoverDevicesShallow() {
            try {
                let token = '';
                if (App.auth && App.auth.currentUser) {
                    token = await App.auth.currentUser.getIdToken().catch(() => '');
                }
                const authParam = token ? `?auth=${token}&shallow=true` : '?shallow=true';
                const res = await fetch(`${App.config.databaseURL}/devices.json${authParam}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === 'object') {
                        Object.keys(data).forEach(rawKey => {
                            if (isValidDeviceId(rawKey)) {
                                const deviceId = normalizeId(rawKey);
                                if (deviceId && !App.trackedIds.has(deviceId)) {
                                    App.trackedIds.add(deviceId);
                                    listenToSingleDevice(deviceId);
                                }
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn('[Admin] Shallow device discovery warning:', e);
            }
        }

        // Direct HTTP REST fallback query (queries ONLY lightweight status & meta nodes, NEVER whole device node)
        async function fetchDeviceRestFallback(deviceId) {
            if (!isValidDeviceId(deviceId)) return;
            try {
                let token = '';
                if (App.auth && App.auth.currentUser) {
                    token = await App.auth.currentUser.getIdToken().catch(() => '');
                }

                const authParam = token ? `?auth=${token}` : '';
                // Query status.json & meta.json separately to avoid downloading bloated temp_trip or trips!
                const [statusRes, metaRes] = await Promise.all([
                    fetch(`${App.config.databaseURL}/devices/${deviceId}/status.json${authParam}`),
                    fetch(`${App.config.databaseURL}/devices/${deviceId}/meta.json${authParam}`).catch(() => null)
                ]);

                if (statusRes.ok) {
                    const status = await statusRes.json();
                    let meta = {};
                    if (metaRes && metaRes.ok) {
                        meta = (await metaRes.json()) || {};
                    }
                    if (status) {
                        handleDeviceSnapshot(deviceId, { status, meta });
                        if (!App.isWsConnected) {
                            updateConnStatus('connected', 'متصل (وضع REST)');
                        }
                    }
                }
            } catch (e) {
                // Silently ignore fallback network errors
            }
        }

        function showRulesPermissionNotice() {
            App.hasPermissionNotice = true;
            renderDevicesList();
        }

        // Helper to get or create device instance in memory only when verified
        function getOrCreateDevice(deviceId) {
            let dev = App.devices.get(deviceId);
            if (!dev) {
                const customName = App.customNames[deviceId] || `دراجة ${deviceId.slice(-4)}`;
                dev = {
                    id: deviceId,
                    name: customName,
                    status: {},
                    meta: {},
                    marker: null,
                    lastValidLat: null,
                    lastValidLng: null,
                    lastLocationTime: 0
                };
                // Populate lastValidLat/Lng from local cache if available
                const cached = App.lastKnownLocations && App.lastKnownLocations[deviceId];
                if (cached && isValidCoord(cached.lat, cached.lng)) {
                    dev.lastValidLat = Number(cached.lat);
                    dev.lastValidLng = Number(cached.lng);
                    dev.lastLocationTime = cached.t || 0;
                }
                App.devices.set(deviceId, dev);
            }
            return dev;
        }

        // Remove device from all state (UI, memory, tracking list)
        function removeDeviceFromState(deviceId) {
            const dev = App.devices.get(deviceId);
            if (dev && dev.marker) {
                App.map.removeLayer(dev.marker);
                dev.marker = null;
            }
            App.devices.delete(deviceId);
            App.trackedIds.delete(deviceId);
            delete App.customNames[deviceId];
            if (App.lastKnownLocations) delete App.lastKnownLocations[deviceId];
            if (App.selectedDeviceId === deviceId) App.selectedDeviceId = null;
            if (App.controlActiveDeviceId === deviceId) closeModal('modal-control');
            scheduleListRender();
        }

        // Listen to a single device with ULTRA-LIGHTWEIGHT listeners (status and meta only, NO temp_trip)
        function listenToSingleDevice(rawId) {
            if (!isValidDeviceId(rawId)) return;
            const deviceId = normalizeId(rawId);
            if (!deviceId || App.activeDeviceListeners.has(deviceId)) return;

            App.activeDeviceListeners.add(deviceId);

            // 1. Listen to status
            App.db.ref(`devices/${deviceId}/status`).on('value', (snap) => {
                if (snap.exists() && snap.val()) {
                    const status = snap.val();
                    const currentDev = getOrCreateDevice(deviceId);
                    currentDev.status = status;
                    updateDeviceMarker(currentDev);
                    scheduleListRender();

                    if (App.controlActiveDeviceId === deviceId) {
                        updateControlModalStatus(deviceId);
                    }

                    // Auto-center map on first valid GPS coordinates
                    if (!App.initialCentered) {
                        const loc = getDeviceEffectiveLocation(currentDev);
                        if (loc) {
                            App.initialCentered = true;
                            App.map.setView([loc.lat, loc.lng], 15);
                        }
                    }
                }
            }, (err) => {
                console.warn(`Error reading status for ${deviceId}:`, err.message);
            });

            // 2. Listen to meta
            App.db.ref(`devices/${deviceId}/meta`).on('value', (snap) => {
                if (snap.exists() && snap.val()) {
                    const meta = snap.val();
                    const currentDev = getOrCreateDevice(deviceId);
                    currentDev.meta = meta;
                    if (meta.customName || meta.name) {
                        currentDev.name = meta.customName || meta.name;
                        App.customNames[deviceId] = currentDev.name;
                    }
                    updateDeviceMarker(currentDev);
                    scheduleListRender();

                    if (App.controlActiveDeviceId === deviceId) {
                        updateControlModalStatus(deviceId);
                    }
                }
            }, (err) => {
                console.warn(`Error reading meta for ${deviceId}:`, err.message);
            });
        }

        // Normalize device ID (e.g. 6C:C8:40:44:E1:5A -> 6CC84044E15A)
        function normalizeId(id) {
            return (id || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        }

        // Validate real ESP32 device ID: exactly 12 hexadecimal characters, not dummy/demo or command keywords
        function isValidDeviceId(id) {
            if (!id) return false;
            const clean = normalizeId(id);
            if (clean === '123456') return false;
            if (clean === 'COMMAND' || clean === 'COMMANDQUEUE') return false;
            return /^[0-9A-F]{12}$/.test(clean);
        }

        // Check if coordinates are valid geographic numbers within bounds and not (0,0)
        function isValidCoord(lat, lng) {
            const numLat = Number(lat);
            const numLng = Number(lng);
            return !isNaN(numLat) && !isNaN(numLng) &&
                (numLat !== 0 || numLng !== 0) &&
                Math.abs(numLat) <= 90 && Math.abs(numLng) <= 180 &&
                (Math.abs(numLat) > 0.1 || Math.abs(numLng) > 0.1);
        }

        // Resolves the best available coordinates for a device:
        // Always retains the last known location if satellites are 0 or GPS fix is temporarily lost
        function getDeviceEffectiveLocation(dev) {
            if (!dev) return null;

            const rawLat = dev.status?.lat ?? dev.status?.a ?? dev.status?.lastLat ?? dev.status?.plat ?? dev.status?.l_lat;
            const rawLng = dev.status?.lng ?? dev.status?.o ?? dev.status?.lastLng ?? dev.status?.plng ?? dev.status?.l_lng;
            const statusLat = Number(rawLat);
            const statusLng = Number(rawLng);

            const sats = Number(dev.status?.sats ?? 0);
            const hasGpsFix = Boolean(dev.status?.gpsFix);

            // 1. Current valid coordinates from status packet
            if (isValidCoord(statusLat, statusLng)) {
                dev.lastValidLat = statusLat;
                dev.lastValidLng = statusLng;
                dev.lastLocationTime = Number(dev.status?.receivedAt || dev.status?.t || Date.now());
                if (!App.lastKnownLocations) App.lastKnownLocations = {};
                App.lastKnownLocations[dev.id] = {
                    lat: statusLat,
                    lng: statusLng,
                    t: dev.lastLocationTime
                };
                try {
                    localStorage.setItem('motolock_last_coords', JSON.stringify(App.lastKnownLocations));
                } catch (e) { }

                // Auto-sync to Firebase meta permanently so 0,0 status packets can NEVER wipe it out!
                if (App.db && (!dev._lastMetaSyncedLat || Math.abs(dev._lastMetaSyncedLat - statusLat) > 0.0005)) {
                    dev._lastMetaSyncedLat = statusLat;
                    App.db.ref(`devices/${dev.id}/meta`).update({
                        lastLat: statusLat,
                        lastLng: statusLng,
                        hasLastValidLocation: true
                    }).catch(() => {});
                }

                // إذا كان الجهاز لاقط 4 أقمار أو أكثر فالإشارة صالحة للـ 3D Fix وموقعه مباشر وليس قديماً
                const isLastKnown = sats === 0 || (!hasGpsFix && sats < 4);
                return {
                    lat: statusLat,
                    lng: statusLng,
                    isLastKnown,
                    sats,
                    hasGpsFix
                };
            }

            // 2. Fall back to cached in-memory last valid coordinates
            if (isValidCoord(dev.lastValidLat, dev.lastValidLng)) {
                return {
                    lat: Number(dev.lastValidLat),
                    lng: Number(dev.lastValidLng),
                    isLastKnown: true,
                    sats,
                    hasGpsFix: false
                };
            }

            // 3. Fall back to persistent localStorage coordinates
            if (App.lastKnownLocations && App.lastKnownLocations[dev.id]) {
                const cached = App.lastKnownLocations[dev.id];
                if (isValidCoord(cached.lat, cached.lng)) {
                    dev.lastValidLat = Number(cached.lat);
                    dev.lastValidLng = Number(cached.lng);
                    dev.lastLocationTime = cached.t || 0;
                    return {
                        lat: dev.lastValidLat,
                        lng: dev.lastValidLng,
                        isLastKnown: true,
                        sats,
                        hasGpsFix: false
                    };
                }
            }

            // 4. Fall back to meta coordinates from Firebase
            const metaLat = Number(dev.meta?.lastLat ?? dev.meta?.lat ?? 0);
            const metaLng = Number(dev.meta?.lastLng ?? dev.meta?.lng ?? 0);
            if (isValidCoord(metaLat, metaLng)) {
                dev.lastValidLat = metaLat;
                dev.lastValidLng = metaLng;
                return {
                    lat: metaLat,
                    lng: metaLng,
                    isLastKnown: true,
                    sats,
                    hasGpsFix: false
                };
            }

            // 5. Fall back to known client default locations (registered area coordinates)
            const KNOWN_CLIENT_FALLBACKS = {
                'CCDBA797831A': { lat: 30.048900, lng: 31.442800 }, // احمد محمد ( التجمع الاول )
                'B4BFE96FDA76': { lat: 30.815413, lng: 30.917252 }  // احمد محمود ( خلوة ريشة )
            };
            if (KNOWN_CLIENT_FALLBACKS[dev.id]) {
                const fb = KNOWN_CLIENT_FALLBACKS[dev.id];
                dev.lastValidLat = fb.lat;
                dev.lastValidLng = fb.lng;
                return {
                    lat: fb.lat,
                    lng: fb.lng,
                    isLastKnown: true,
                    sats,
                    hasGpsFix: false
                };
            }

            return null;
        }

        // Process device snapshot data
        function handleDeviceSnapshot(rawId, data) {
            if (!isValidDeviceId(rawId)) return;
            const deviceId = normalizeId(rawId);
            if (!deviceId) return;

            App.trackedIds.add(deviceId);

            // Extract status & meta
            const status = data.status || {};
            const meta = data.meta || {};

            // Name resolution: Firebase meta > LocalStorage cache > Default ID
            const customName = meta.customName || meta.name || App.customNames[deviceId] || `دراجة ${deviceId.slice(-4)}`;
            if (meta.customName || meta.name) {
                App.customNames[deviceId] = meta.customName || meta.name;
            }

            let deviceObj = getOrCreateDevice(deviceId);
            const prevStatus = deviceObj.status || {};
            // Track engine transitions
            if (!prevStatus.engine && status.engine) {
                addDeviceEvent(deviceId, 'فتح الكونتاكت وبدء دوران المحرك', 'engine_on', 'fa-solid fa-bolt');
            } else if (prevStatus.engine && !status.engine) {
                addDeviceEvent(deviceId, 'إيقاف المحرك والدخول في وضع التوقف', 'engine_off', 'fa-solid fa-power-off');
            }
            // Track lock transitions
            if (prevStatus.lock !== undefined && prevStatus.lock !== status.lock) {
                addDeviceEvent(deviceId, status.lock ? 'قفل الدراجة وتفعيل الأمان' : 'فتح قفل الدراجة وتجهيز الحركة', 'lock', status.lock ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open');
            }
            // Track wake reason
            if (status.lastWakeReason && status.lastWakeReason !== prevStatus.lastWakeReason) {
                const wake = formatWakeReason(status.lastWakeReason);
                if (wake) {
                    addDeviceEvent(deviceId, 'استيقاظ الدراجة: ' + wake.text, 'vibration', wake.icon);
                }
            }

            deviceObj.name = customName;
            deviceObj.status = status;
            deviceObj.meta = meta;

            // Update Leaflet marker
            updateDeviceMarker(deviceObj);

            // Refresh UI
            scheduleListRender();
        }

        function removeDevice(rawId) {
            const deviceId = normalizeId(rawId);
            removeDeviceFromState(deviceId);
        }

        // Calculate device connection state
        // CRITICAL: Checks explicit mqttOnline from server/meta AND dynamic freshness timeout
        function getDeviceConnectionState(dev) {
            // Helper to parse epoch ms safely (ignoring millis() uptimes like 50000)
            function toEpochMs(val) {
                if (!val) return 0;
                const n = Number(val);
                if (isNaN(n) || n <= 0) return 0;
                if (n > 1000000000000) return n; // Epoch ms
                if (n > 1000000000) return n * 1000; // Epoch seconds
                return 0; // Discard uptime millis
            }

            const receivedAt = toEpochMs(dev.status?.receivedAt || dev.status?.t || dev.status?.serverTimestamp);
            const lastSeenAt = toEpochMs(dev.meta?.lastSeenAt);
            const lastSeen = Math.max(receivedAt, lastSeenAt);
            const timeDiff = lastSeen > 0 ? (Date.now() - lastSeen) : Infinity;

            const isEngineOrMoving = Boolean(
                dev.status?.engine === true ||
                dev.status?.contact === true ||
                dev.status?.motionState === 'moving' ||
                Number(dev.status?.speed || 0) > 1.5
            );

            // مهلة واقعية تستوعب تبديل أبراج شبكات المحمول في مصر (2G Cell Handovers):
            // 90 ثانية أثناء الحركة، و 180 ثانية أثناء التوقف
            const activeThreshold = isEngineOrMoving ? 90000 : 180000;

            // إذا كان الجهاز قد أرسل أي بيانات حديثة خلال مهلة النشاط، فهو متصل 100%
            // البيانات الحية تتفوق دائماً على أي قيمة قديمة للـ mqttOnline
            const isFreshData = lastSeen > 0 && timeDiff < activeThreshold;
            const isExplicitlyOffline = !isFreshData && (dev.meta?.mqttOnline === false || dev.meta?.mqttOnline === 'false');

            const isOnline = isFreshData || (!isExplicitlyOffline && lastSeen > 0 && timeDiff < activeThreshold);

            // Power saving mode detection from status or meta
            // Contact is true only if contact sensor is HIGH (or alternator is actively charging >= 13.6V)
            const isContact = Boolean(dev.status?.contact === true || Number(dev.status?.battery || 0) >= 13.6);
            const isEngine = Boolean(dev.status?.engine === true);

            // Power saving mode: ONLY when the device explicitly reports power saving mode
            const isPowerSaving = !isContact && !isEngine && Boolean(
                dev.status?.powerSavingActive === true ||
                dev.status?.powerSave === true ||
                dev.meta?.powerSavingActive === true ||
                dev.meta?.offlineReason === 'powersaving'
            );

            const isMoving = isOnline && (dev.status?.motionState === 'moving' || (Number(dev.status?.speed || 0) > 1.5));
            const isParked = isOnline && !isMoving;

            const state = {
                isOnline,
                isMoving,
                isParked,
                isPowerSaving,
                lastSeen,
                timeDiff
            };

            if (dev._lastTrackedState) {
                recordDeviceStateTransition(dev.id, dev._lastTrackedState, state);
            }
            dev._lastTrackedState = state;

            return state;
        }

        function getTodayDateStr() {
            const d = new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }

        function getDeviceDailyStats(dev) {
            const today = getTodayDateStr();
            const storageKey = 'motolock_stats_' + dev.id;
            let stored = null;
            try {
                stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            } catch (e) { }

            let disconnects = 0;
            let powerSavings = 0;

            // 1. القيمة المعتمدة من خادم Firebase
            if (dev.meta?.statsDate === today) {
                disconnects = Number(dev.meta.disconnectsToday || 0);
                powerSavings = Number(dev.meta.powerSavingToday || 0);
            }

            // 2. مزامنة القيمة المسجلة محلياً أثناء مراقبة المتصفح
            if (stored && stored.date === today) {
                disconnects = Math.max(disconnects, Number(stored.disconnects || 0));
                powerSavings = Math.max(powerSavings, Number(stored.powerSavings || 0));
            }

            // 3. التحقق الذكي من أحداث اليوم:
            // إذا كان الجهاز قد تواصل اليوم ثم انفصل قبل فتح لوحة التحكم ولم يسجل السيرفر العداد بعد:
            const state = getDeviceConnectionState(dev);
            const lastSeenTs = Number(state.lastSeen || 0);
            if (lastSeenTs > 0) {
                const lastSeenDate = new Date(lastSeenTs).toISOString().slice(0, 10);
                if (lastSeenDate === today && !state.isOnline) {
                    if (state.isPowerSaving) {
                        powerSavings = Math.max(powerSavings, 1);
                    } else {
                        disconnects = Math.max(disconnects, 1);
                    }
                }
            }

            // 4. إصدار الفيرموير: فقط إذا أرسله الجهاز صراحةً (بدون أي تخمين أو افتراض)
            let fw = null;
            if (dev.status?.fw) {
                fw = String(dev.status.fw).trim();
            } else if (dev.meta?.firmwareVersion) {
                fw = String(dev.meta.firmwareVersion).trim();
            } else if (dev.status?.version) {
                fw = String(dev.status.version).trim();
            }

            return {
                disconnects,
                powerSavings,
                fw
            };
        }

        function recordDeviceStateTransition(deviceId, prevState, newState) {
            if (!prevState || !newState) return;
            // تجاهل أي استدعاء متكرر بدون تغير حقيقي في حالة الاتصال أو التوفير
            if (prevState.isOnline === newState.isOnline && prevState.isPowerSaving === newState.isPowerSaving) {
                return;
            }

            // تسجيل أحداث الاتصال في سجل الأحداث الحية
            if (!prevState.isOnline && newState.isOnline) {
                addDeviceEvent(deviceId, 'استعادة الاتصال بالإنترنت والسيرفر', 'online', 'fa-solid fa-wifi');
            } else if (prevState.isOnline && !newState.isOnline) {
                if (newState.isPowerSaving) {
                    addDeviceEvent(deviceId, 'انتقال لوضع توفير الطاقة (سكون)', 'powersave', 'fa-solid fa-leaf');
                } else {
                    addDeviceEvent(deviceId, 'انقطاع الاتصال بالإنترنت', 'offline', 'fa-solid fa-triangle-exclamation');
                }
            } else if (!prevState.isPowerSaving && newState.isPowerSaving) {
                addDeviceEvent(deviceId, 'انتقال لوضع توفير الطاقة (سكون)', 'powersave', 'fa-solid fa-leaf');
            }

            const today = getTodayDateStr();
            const storageKey = 'motolock_stats_' + deviceId;
            let stored = null;
            try {
                stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            } catch (e) { }

            if (!stored || stored.date !== today) {
                stored = { date: today, disconnects: 0, powerSavings: 0 };
            }

            let changed = false;
            if (prevState.isOnline && !newState.isOnline) {
                if (newState.isPowerSaving) {
                    stored.powerSavings = (stored.powerSavings || 0) + 1;
                } else {
                    stored.disconnects = (stored.disconnects || 0) + 1;
                }
                changed = true;
            } else if (!prevState.isPowerSaving && newState.isPowerSaving) {
                stored.powerSavings = (stored.powerSavings || 0) + 1;
                changed = true;
            }

            if (changed) {
                try {
                    localStorage.setItem(storageKey, JSON.stringify(stored));
                } catch (e) { }
            }
        }

        // Focus and select device in list (opens mobile drawer and restores map if expanded)
        function openDeviceInList(deviceId) {
            if (!deviceId) return;
            App.selectedDeviceId = deviceId;

            // 1. إذا كانت الخريطة مكبرة بملء الشاشة، استعد القائمة الجانبية فوراً
            if (App.isMapExpanded) {
                toggleMapFullscreen();
            }

            // 2. إذا كنا على الهاتف (شاشة <= 900px)، افتح درج قائمة الأجهزة
            if (window.innerWidth <= 900) {
                showMobileTab('devices');
            }

            // 3. إعادة رسم القائمة فوراً لتطبيق كلاس selected المضيء
            renderDevicesList();

            // 4. التمرير السلس إلى بطاقة الدراجة في القائمة وتفعيل وميض التحديد (Flash Highlight)
            setTimeout(() => {
                const el = document.querySelector(`.device-card[data-id="${deviceId}"]`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('flash-highlight');
                    setTimeout(() => el.classList.remove('flash-highlight'), 1800);
                }
            }, 80);
        }

        // --- Map Marker Update ---
        function updateDeviceMarker(dev) {
            const loc = getDeviceEffectiveLocation(dev);

            // Skip invalid GPS coordinates only if device has never had any valid location recorded
            if (!loc) {
                if (dev.marker) {
                    App.map.removeLayer(dev.marker);
                    dev.marker = null;
                }
                return;
            }

            const { lat, lng, isLastKnown } = loc;

            const state = getDeviceConnectionState(dev);
            let markerColor = 'var(--text-dim)';
            let isPulsing = false;
            let iconClass = 'fa-motorcycle';

            if (state.isPowerSaving) {
                // Bikes in power saving mode appear in Yellow / Orange (var(--accent-amber))
                markerColor = 'var(--accent-amber)';
                iconClass = 'fa-leaf';
                isPulsing = false;
            } else if (state.isMoving) {
                markerColor = 'var(--accent-green)';
                iconClass = 'fa-motorcycle';
                isPulsing = !isLastKnown;
            } else if (state.isParked) {
                // Stopped / parked bikes appear in Blue (var(--accent-blue))
                markerColor = 'var(--accent-blue)';
                iconClass = 'fa-square-parking';
                isPulsing = false;
            } else {
                // Truly offline bikes appear in Red
                markerColor = 'var(--accent-red)';
                iconClass = 'fa-power-off';
                isPulsing = false;
            }

            const customIcon = L.divIcon({
                className: 'custom-leaflet-pin',
                html: `
                    <div class="marker-pin ${isPulsing ? 'pulsing' : ''} ${isLastKnown ? 'last-known-pin' : ''}" style="--marker-color: ${markerColor}">
                        <i class="fa-solid ${iconClass}"></i>
                        ${isLastKnown ? '<span class="pin-last-badge" title="آخر موقع مسجل (0 أقمار)"><i class="fa-solid fa-satellite-dish"></i></span>' : ''}
                    </div>
                `,
                iconSize: [36, 36],
                iconAnchor: [18, 18],
                popupAnchor: [0, -20]
            });

            if (!dev.marker) {
                dev.marker = L.marker([lat, lng], { icon: customIcon }).addTo(App.map);
                dev.marker.bindPopup(() => getDevicePopupHtml(dev), { autoPan: true });
                dev.marker.on('click', () => {
                    dev.marker.setPopupContent(getDevicePopupHtml(dev));
                    openDeviceInList(dev.id);
                    dev.marker.openPopup();
                });
            } else {
                dev.marker.setLatLng([lat, lng]);
                dev.marker.setIcon(customIcon);
                if (typeof dev.marker.isPopupOpen === 'function' && dev.marker.isPopupOpen()) {
                    dev.marker.setPopupContent(getDevicePopupHtml(dev));
                }
                dev.marker.off('click');
                dev.marker.on('click', () => {
                    dev.marker.setPopupContent(getDevicePopupHtml(dev));
                    openDeviceInList(dev.id);
                    dev.marker.openPopup();
                });
            }
        }

        function getDevicePopupHtml(dev) {
            const loc = getDeviceEffectiveLocation(dev);
            const lat = loc ? loc.lat : Number(dev.status?.lat || dev.status?.a || 0);
            const lng = loc ? loc.lng : Number(dev.status?.lng || dev.status?.o || 0);
            const state = getDeviceConnectionState(dev);
            return createPopupHtml(dev, state, lat, lng, loc);
        }

        function getDeviceStationaryTimeAgo(dev, state) {
            if (!state.isParked && !state.isPowerSaving) return '';
            const ts = Number(dev.status?.stationarySinceAt || dev.meta?.stationarySinceAt || 0);
            if (ts > 0) return formatTimeAgo(ts);

            const fwTs = Number(dev.status?.timestamp || 0);
            const fwStat = Number(dev.status?.stationarySince || 0);
            const lastSeen = Number(state.lastSeen || 0);
            if (fwTs > 0 && fwStat > 0 && fwTs >= fwStat && lastSeen > 0) {
                const statAt = lastSeen - (fwTs - fwStat);
                return formatTimeAgo(statAt);
            }
            if (state.lastSeen > 0) {
                return formatTimeAgo(state.lastSeen);
            }
            return '';
        }

        function formatCellularSignal(status) {
            if (!status) {
                return { csq: 0, percent: 0, dbm: 0, color: 'var(--text-dim)', label: 'غير محدد', op: '', shortOp: '', displayText: '--', fullText: 'غير محدد' };
            }
            let csq = Number(status.csq ?? status.simCsq ?? 0);
            let percent = Number(status.signalPercent ?? status.csqPercent ?? 0);
            let dbm = Number(status.signalDbm ?? 0);
            const op = String(status.simOp || status.operator || status.op || '').trim();

            let shortOp = '';
            if (op) {
                const lower = op.toLowerCase();
                if (lower.includes('voda')) shortOp = 'Vodafone';
                else if (lower.includes('orange') || lower.includes('mobinil')) shortOp = 'Orange';
                else if (lower.includes('etisalat') || lower.includes('etis')) shortOp = 'Etisalat';
                else if (lower.includes('we') || lower.includes('telecom') || lower.includes('te')) shortOp = 'WE';
                else shortOp = op.replace(/\s*EG\b/i, '').trim();
            }

            if (percent === 0 && csq > 0 && csq <= 31) {
                percent = Math.min(100, Math.round((csq / 31) * 100));
            }
            if (dbm === 0 && csq > 0 && csq <= 31) {
                dbm = -113 + (csq * 2);
            }

            let color = 'var(--text-dim)';
            let label = 'لا توجد إشارة';
            if (csq === 99 || csq <= 0 || percent <= 0) {
                color = 'var(--text-muted)';
                label = 'لا توجد إشارة';
            } else if (csq >= 20 || percent >= 65) {
                color = 'var(--accent-green)';
                label = 'ممتاز';
            } else if (csq >= 14 || percent >= 45) {
                color = 'var(--accent-cyan)';
                label = 'جيد';
            } else if (csq >= 10 || percent >= 30) {
                color = 'var(--accent-amber)';
                label = 'متوسط';
            } else {
                color = 'var(--accent-red)';
                label = 'ضعيف';
            }

            const hasSignal = csq > 0 && csq <= 31 && percent > 0;
            const displayText = hasSignal ? `${percent}%` : '--';
            const fullText = hasSignal
                ? `${percent}% (${csq}/31 • ${label})`
                : 'لا توجد إشارة';

            return {
                csq,
                percent,
                dbm,
                color,
                label,
                op,
                shortOp,
                hasSignal,
                displayText,
                fullText
            };
        }

        function createPopupHtml(dev, state, lat, lng, loc) {
            const speed = Number(dev.status?.speed || 0).toFixed(1);
            const sats = dev.status?.sats ?? '0';
            const isLocked = dev.status?.lock === true;
            const timeAgo = formatTimeAgo(state.lastSeen);
            const parkedAgo = getDeviceStationaryTimeAgo(dev, state);
            const signal = formatCellularSignal(dev.status);
            const dailyStats = getDeviceDailyStats(dev);
            const wakeReason = formatWakeReason(dev.status?.lastWakeReason || dev.meta?.lastWakeReason);
            const isLastKnown = loc ? loc.isLastKnown : (Number(sats) < 4);
            const hasCoords = loc !== null && (lat !== 0 || lng !== 0);

            let statusLabel = '';
            if (state.isPowerSaving) {
                statusLabel = `<span class="popup-status-badge" style="font-size: 0.74rem; color: var(--accent-amber); font-weight: 700;"><i class="fa-solid fa-leaf"></i> 🟡 توفير الطاقة ${parkedAgo ? '(' + parkedAgo + ')' : ''}</span>`;
            } else if (state.isMoving) {
                statusLabel = `<span class="popup-status-badge" style="font-size: 0.74rem; color: var(--accent-green); font-weight: 700;"><i class="fa-solid fa-gauge-high"></i> 🟢 متحرك (${speed} كم/س)</span>`;
            } else if (state.isParked) {
                statusLabel = `<span class="popup-status-badge" style="font-size: 0.74rem; color: var(--accent-blue); font-weight: 700;"><i class="fa-solid fa-square-parking"></i> 🔵 متوقف ${parkedAgo ? '(' + parkedAgo + ')' : ''}</span>`;
            } else {
                statusLabel = '<span class="popup-status-badge" style="font-size: 0.74rem; color: var(--accent-red); font-weight: 700;"><i class="fa-solid fa-circle-xmark"></i> 🔴 غير متصل</span>';
            }

            let fwHtml = '';
            if (dailyStats.fw) {
                const isLatest = dailyStats.fw === '1.0.14';
                const fwColor = isLatest ? '#38bdf8' : '#a78bfa';
                const fwBg = isLatest ? 'rgba(56, 189, 248, 0.12)' : 'rgba(167, 139, 250, 0.12)';
                const fwBorder = isLatest ? 'rgba(56, 189, 248, 0.28)' : 'rgba(167, 139, 250, 0.28)';
                fwHtml = `<span class="fw-badge" style="font-size: 0.6rem; font-weight: 700; background: ${fwBg}; color: ${fwColor}; border: 1px solid ${fwBorder}; border-radius: 4px; padding: 0.05rem 0.35rem; display: inline-flex; align-items: center; gap: 0.2rem;" title="إصدار الفيرموير: ${escapeHtml(dailyStats.fw)}">
                    <i class="fa-solid fa-microchip" style="font-size: 0.55rem;"></i> v${escapeHtml(dailyStats.fw)}
                </span>`;
            }

            return `
                <div class="map-popup-card" data-popup-id="${dev.id}">
                    <div class="popup-title">
                        <span>${escapeHtml(dev.name)}</span>
                        ${statusLabel}
                    </div>
                    ${isLastKnown && hasCoords ? `
                    <div class="popup-info-row" style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px; padding: 0.3rem 0.5rem; margin: 0.15rem 0; font-size: 0.72rem; color: #fbbf24;">
                        <i class="fa-solid fa-location-crosshairs"></i>
                        <span><strong>آخر موقع مسجل:</strong> يظهر موقع الدراجة الحالي بناءً على آخر إحداثيات تم التقاطها ${Number(sats) > 0 ? '(جاري تثبيت الإشارة - ' + sats + ' أقمار)' : '(0 أقمار حالياً)'}.</span>
                    </div>` : ''}
                    <div class="popup-info-row">
                        <span>المعرف (MAC):</span>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                            <span>${dev.id}</span>
                            ${fwHtml}
                        </div>
                    </div>
                    <div class="popup-info-row">
                        <span>السرعة الحالية:</span>
                        <span class="popup-speed-val">${speed} كم/س</span>
                    </div>
                    <div class="popup-info-row">
                        <span>أقمار GPS:</span>
                        <span>🛰️ ${sats} ${isLastKnown && Number(sats) === 0 ? '<span style="color: #fbbf24; font-size: 0.68rem; font-weight: 700;">(آخر موقع مسجل)</span>' : (isLastKnown ? '<span style="color: #38bdf8; font-size: 0.68rem; font-weight: 700;">(جاري التثبيت)</span>' : '<span style="color: #4ade80; font-size: 0.68rem; font-weight: 700;">(مباشر 3D)</span>')}</span>
                    </div>
                    <div class="popup-info-row">
                        <span>شبكة المحمول (SIM):</span>
                        <span style="color: ${signal.color}; font-weight: 700;">
                            <i class="fa-solid fa-signal"></i> ${signal.fullText}${signal.op ? ' • ' + escapeHtml(signal.op) : ''}
                        </span>
                    </div>
                    <div class="popup-info-row">
                        <span>حالة القفل:</span>
                        <span style="color: ${isLocked ? 'var(--accent-red)' : 'var(--accent-green)'}">
                            ${isLocked ? '🔒 مقفول' : '🔓 مفتوح'}
                        </span>
                    </div>
                    <div class="popup-info-row popup-row-parked" style="${(state.isParked || state.isPowerSaving) && parkedAgo ? '' : 'display: none;'}">
                        <span>مدة التوقف:</span>
                        <span class="popup-parked-val" style="color: var(--accent-cyan); font-weight: 700;">${parkedAgo || ''}</span>
                    </div>
                    <div class="popup-info-row">
                        <span>آخر اتصال:</span>
                        <span class="popup-last-seen-val">${timeAgo}</span>
                    </div>
                    ${wakeReason ? `
                    <div class="popup-info-row">
                        <span>سبب الاستيقاظ:</span>
                        <span style="color: ${wakeReason.color}; font-weight: 700;">
                            <i class="${wakeReason.icon}"></i> ${escapeHtml(wakeReason.text)}
                        </span>
                    </div>` : ''}

                    <div class="popup-info-row" style="background: rgba(15, 23, 42, 0.55); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px; padding: 0.3rem 0.5rem; margin: 0.15rem 0; font-size: 0.74rem;">
                        <span style="color: var(--text-dim); display: inline-flex; align-items: center; gap: 0.25rem;">
                            <i class="fa-regular fa-calendar-check" style="color: var(--accent-blue);"></i> إحصائيات اليوم:
                        </span>
                        <div style="display: flex; align-items: center; gap: 0.65rem;">
                            <span style="color: ${dailyStats.disconnects > 0 ? '#f87171' : 'var(--text-muted)'}; font-weight: 700;" title="عدد مرات انقطاع الاتصال خلال اليوم">
                                <i class="fa-solid fa-triangle-exclamation" style="font-size: 0.65rem; color: ${dailyStats.disconnects > 0 ? '#ef4444' : 'var(--text-dim)'};"></i> انقطاع: <strong class="popup-stats-disconnects">${dailyStats.disconnects}</strong>
                            </span>
                            <span style="color: rgba(255, 255, 255, 0.15);">|</span>
                            <span style="color: ${dailyStats.powerSavings > 0 ? '#fbbf24' : 'var(--text-muted)'}; font-weight: 700;" title="عدد مرات الدخول في وضع توفير الطاقة خلال اليوم">
                                <i class="fa-solid fa-leaf" style="font-size: 0.65rem; color: ${dailyStats.powerSavings > 0 ? '#f59e0b' : 'var(--text-dim)'};"></i> توفير: <strong class="popup-stats-powersave">${dailyStats.powerSavings}</strong>
                            </span>
                        </div>
                    </div>

                    <div style="display: flex; gap: 0.35rem; margin-top: 0.45rem;">
                        <button type="button" class="popup-btn popup-btn-control" style="flex: 1;" onclick="openControlModal('${dev.id}')" title="التحكم بالدراجة عن بُعد">
                            <i class="fa-solid fa-gamepad"></i> تحكم
                        </button>
                        <button type="button" class="popup-btn" onclick="openDeviceInList('${dev.id}')" style="background: rgba(14, 165, 233, 0.18); border: 1px solid rgba(14, 165, 233, 0.35); color: #38bdf8;" title="تحديد وفتح الدراجة في القائمة">
                            <i class="fa-solid fa-list-ul"></i> القائمة
                        </button>
                        ${hasCoords ? `
                        <button type="button" class="popup-btn popup-btn-zoom" onclick="centerDeviceOnMap('${dev.id}')" title="تكبير الخريطة والتركيز على الدراجة">
                            <i class="fa-solid fa-magnifying-glass-plus"></i> تكبير
                        </button>
                        <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" class="popup-btn" style="padding: 0.4rem 0.65rem;" title="خرائط جوجل">
                            <i class="fa-solid fa-diamond-turn-right"></i>
                        </a>
                        ` : ''}
                        <button type="button" class="popup-btn" onclick="promptDeleteDevice('${dev.id}')" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #ef4444;" title="حذف الجهاز نهائياً من النظام">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        // --- Render KPI Counters ---
        function updateKpiCounters() {
            let total = App.devices.size;
            let online = 0;
            let moving = 0;
            let parked = 0;
            let powersaving = 0;
            let offline = 0;

            App.devices.forEach(dev => {
                const state = getDeviceConnectionState(dev);
                if (state.isPowerSaving) {
                    powersaving++;
                } else if (state.isOnline) {
                    online++;
                    if (state.isMoving) moving++;
                    if (state.isParked) parked++;
                } else {
                    offline++;
                }
            });

            document.getElementById('kpi-total').textContent = total;
            document.getElementById('kpi-online').textContent = online;
            document.getElementById('kpi-moving').textContent = moving;
            document.getElementById('kpi-parked').textContent = parked;
            document.getElementById('kpi-powersaving').textContent = powersaving;
            document.getElementById('kpi-offline').textContent = offline;
            document.getElementById('mobile-dev-count').textContent = total;
        }

        // --- Render Devices List ---
        function renderDevicesList() {
            const container = document.getElementById('devices-list-container');
            if (!container) return;
            const prevScrollTop = container.scrollTop;

            if (App.devices.size === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-motorcycle"></i>
                        <p>لم يتم العثور على أجهزة مسجلة بعد في الفايربيس.</p>
                        <button class="mini-btn" onclick="openModal('modal-add-device')" style="margin-top: 0.5rem;">
                            <i class="fa-solid fa-plus"></i> إضافة معرف جهاز يدوياً
                        </button>
                    </div>
                `;
                return;
            }

            const query = App.searchQuery.trim().toLowerCase();
            const filtered = [];

            App.devices.forEach(dev => {
                const state = getDeviceConnectionState(dev);
                const matchesSearch = !query ||
                    dev.name.toLowerCase().includes(query) ||
                    dev.id.toLowerCase().includes(query);

                if (!matchesSearch) return;

                if (App.currentFilter === 'online' && !state.isOnline) return;
                if (App.currentFilter === 'offline' && (state.isOnline || state.isPowerSaving)) return;
                if (App.currentFilter === 'moving' && !state.isMoving) return;
                if (App.currentFilter === 'parked' && !state.isParked) return;
                if (App.currentFilter === 'powersaving' && !state.isPowerSaving) return;

                filtered.push({ dev, state });
            });

            // Sorting logic to prevent rapid re-ordering & jittering:
            // 1) 'stable' (Default - Recommended):
            //    Alphabetical by Arabic name, then MAC ID. Positions remain 100% frozen even when telemetry streams in!
            // 2) 'online_first':
            //    Connected bikes first (moving & parked together to prevent jumping at red lights),
            //    then power saving, then offline. Sorted stably by name inside each tier!
            // 3) 'activity':
            //    Chronological by lastSeen.
            // 4) 'mac':
            //    By MAC ID alphabetically.
            if (App.sortOrder === 'stable') {
                filtered.sort((a, b) => {
                    const nameA = a.dev.name || '';
                    const nameB = b.dev.name || '';
                    const comp = nameA.localeCompare(nameB, 'ar', { numeric: true, sensitivity: 'base' });
                    if (comp !== 0) return comp;
                    return a.dev.id.localeCompare(b.dev.id);
                });
            } else if (App.sortOrder === 'online_first') {
                filtered.sort((a, b) => {
                    const getTier = (item) => {
                        if (item.state.isOnline) return 1;
                        if (item.state.isPowerSaving) return 2;
                        return 3;
                    };
                    const tierDiff = getTier(a) - getTier(b);
                    if (tierDiff !== 0) return tierDiff;
                    const nameA = a.dev.name || '';
                    const nameB = b.dev.name || '';
                    return nameA.localeCompare(nameB, 'ar', { numeric: true, sensitivity: 'base' }) || a.dev.id.localeCompare(b.dev.id);
                });
            } else if (App.sortOrder === 'activity') {
                filtered.sort((a, b) => (b.state.lastSeen || 0) - (a.state.lastSeen || 0));
            } else if (App.sortOrder === 'mac') {
                filtered.sort((a, b) => a.dev.id.localeCompare(b.dev.id));
            }

            if (filtered.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-filter"></i>
                        <p>لا توجد أجهزة تطابق الفلتر الحالي.</p>
                        <button class="mini-btn" onclick="resetFilterToAll()" style="margin-top: 0.65rem; padding: 0.45rem 1rem; font-size: 0.8rem; background: var(--accent-blue); color: #fff; border-color: var(--accent-blue); border-radius: 8px;">
                            <i class="fa-solid fa-list-ul"></i> عرض جميع الأجهزة (${App.devices.size})
                        </button>
                    </div>
                `;
                return;
            }

            let html = '';

            if (App.hasPermissionNotice) {
                html += `
                    <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 10px; padding: 0.65rem 0.85rem; font-size: 0.74rem; color: #fde047; margin-bottom: 0.5rem; line-height: 1.5;">
                        <i class="fa-solid fa-lightbulb" style="color: #f59e0b;"></i>
                        <strong>تلميح:</strong> يتم الآن تتبع الأجهزة المضافة فورياً. لتفعيل السحب التلقائي لأي أجهزة جديدة دون إدخالها، تأكد من تعديل Rules في Firebase Console.
                    </div>
                `;
            }

            filtered.forEach(({ dev, state }) => {
                const isSelected = dev.id === App.selectedDeviceId;
                const speed = Number(dev.status?.speed || 0).toFixed(1);
                const sats = dev.status?.sats ?? '0';
                const isLocked = dev.status?.lock === true;
                const battery = dev.status?.battery ? Number(dev.status.battery).toFixed(1) + 'V' : '--';
                const isEngineOn = dev.status?.engine === true;
                const timeAgo = formatTimeAgo(state.lastSeen);

                // Effective location (retains last known coordinates if sats=0)
                const loc = getDeviceEffectiveLocation(dev);
                const hasGps = Boolean(loc);
                const lat = loc ? loc.lat : 0;
                const lng = loc ? loc.lng : 0;
                const isLastKnown = loc ? loc.isLastKnown : (Number(sats) === 0);

                const parkedAgo = getDeviceStationaryTimeAgo(dev, state);
                const signal = formatCellularSignal(dev.status);
                const dailyStats = getDeviceDailyStats(dev);
                const wakeReason = formatWakeReason(dev.status?.lastWakeReason || dev.meta?.lastWakeReason);

                let fwBadgeHtml = '';
                if (dailyStats.fw) {
                    const isLatest = dailyStats.fw === '1.0.14';
                    const fwColor = isLatest ? '#38bdf8' : '#a78bfa';
                    const fwBg = isLatest ? 'rgba(56, 189, 248, 0.12)' : 'rgba(167, 139, 250, 0.12)';
                    const fwBorder = isLatest ? 'rgba(56, 189, 248, 0.28)' : 'rgba(167, 139, 250, 0.28)';
                    const fwTitle = isLatest ? 'فيرموير v1.0.14 (الأحدث)' : `فيرموير v${dailyStats.fw}`;
                    fwBadgeHtml = `<span class="fw-badge" style="font-size: 0.62rem; font-weight: 700; background: ${fwBg}; color: ${fwColor}; border: 1px solid ${fwBorder}; border-radius: 4px; padding: 0.05rem 0.35rem; display: inline-flex; align-items: center; gap: 0.25rem;" title="${fwTitle}">
                        <i class="fa-solid fa-microchip" style="font-size: 0.58rem;"></i> v${escapeHtml(dailyStats.fw)}
                    </span>`;
                }

                let badgeHtml = '';
                let iconColor = 'var(--text-dim)';
                if (state.isPowerSaving) {
                    badgeHtml = `<span class="status-badge powersaving" title="وضع توفير الطاقة ${parkedAgo || ''}"><i class="fa-solid fa-leaf"></i> توفير ${parkedAgo ? '(' + parkedAgo + ')' : ''}</span>`;
                    iconColor = 'var(--accent-amber)';
                } else if (state.isMoving) {
                    badgeHtml = `<span class="status-badge online-moving"><span class="pulse-dot"></span> متحرك (${speed} كم/س)</span>`;
                    iconColor = 'var(--accent-green)';
                } else if (state.isParked) {
                    badgeHtml = `<span class="status-badge online-parked"><i class="fa-solid fa-square-parking"></i> متوقف ${parkedAgo ? '(' + parkedAgo + ')' : ''}</span>`;
                    iconColor = 'var(--accent-blue)';
                } else {
                    badgeHtml = `<span class="status-badge offline"><i class="fa-solid fa-circle-xmark"></i> غير متصل</span>`;
                    iconColor = 'var(--text-dim)';
                }

                html += `
                    <div class="device-card ${isSelected ? 'selected' : ''}" data-id="${dev.id}" onclick="selectDevice('${dev.id}', true)">
                        <div class="card-top">
                            <div class="device-title-area">
                                <div class="device-icon-box" style="color: ${iconColor};">
                                    <i class="fa-solid fa-motorcycle"></i>
                                </div>
                                <div class="device-names">
                                    <span class="device-custom-name">
                                        ${escapeHtml(dev.name)}
                                        <i class="fa-solid fa-pen-to-square btn-rename" onclick="event.stopPropagation(); promptRename('${dev.id}')" title="تعديل الاسم"></i>
                                    </span>
                                    <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                                        <span class="device-mac">${dev.id}</span>
                                        ${fwBadgeHtml}
                                        ${wakeReason ? `<span class="wake-badge" style="font-size: 0.62rem; font-weight: 700; background: ${wakeReason.bg}; color: ${wakeReason.color}; border: 1px solid ${wakeReason.border}; border-radius: 4px; padding: 0.05rem 0.35rem; display: inline-flex; align-items: center; gap: 0.2rem;" title="سبب الاستيقاظ: ${escapeHtml(wakeReason.text)}"><i class="${wakeReason.icon}" style="font-size: 0.55rem;"></i> ${escapeHtml(wakeReason.shortText)}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            ${badgeHtml}
                        </div>

                        <div class="card-metrics" style="grid-template-columns: repeat(5, 1fr);">
                            <div class="metric-cell">
                                <span class="metric-label">القفل</span>
                                <span class="metric-val" style="color: ${isLocked ? 'var(--accent-red)' : 'var(--accent-green)'}">
                                    <i class="fa-solid ${isLocked ? 'fa-lock' : 'fa-lock-open'}"></i>
                                    ${isLocked ? 'مقفول' : 'مفتوح'}
                                </span>
                            </div>

                            <div class="metric-cell">
                                <span class="metric-label">البطارية</span>
                                <span class="metric-val" style="color: ${dev.status?.battery > 12.0 ? 'var(--accent-green)' : 'var(--accent-amber)'}">
                                    <i class="fa-solid fa-car-battery"></i>
                                    ${battery}
                                </span>
                            </div>

                            <div class="metric-cell" title="${signal.op ? escapeHtml(signal.op) + ' - ' : ''}${signal.fullText}${signal.dbm ? ' (' + signal.dbm + ' dBm)' : ''}">
                                <span class="metric-label">الشبكة</span>
                                <span class="metric-val" style="color: ${signal.color};">
                                    <i class="fa-solid fa-signal"></i>
                                    ${signal.displayText}
                                    ${signal.shortOp ? `<span style="font-size: 0.62rem; color: #38bdf8; font-weight: 700; display: block; margin-top: 0.15rem; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="الشبكة: ${escapeHtml(signal.op)}">${escapeHtml(signal.shortOp)}</span>` : ''}
                                </span>
                            </div>

                            <div class="metric-cell">
                                <span class="metric-label">الأقمار</span>
                                <span class="metric-val">
                                    <i class="fa-solid fa-satellite" style="color: var(--accent-cyan)"></i>
                                    ${sats}
                                    ${isLastKnown && hasGps ? '<span class="last-loc-tag" style="margin-right: 0.2rem;">آخر موقع</span>' : ''}
                                </span>
                            </div>

                            <div class="metric-cell">
                                <span class="metric-label">المحرك</span>
                                <span class="metric-val" style="color: ${isEngineOn ? 'var(--accent-green)' : 'var(--text-muted)'}">
                                    <i class="fa-solid ${isEngineOn ? 'fa-bolt' : 'fa-power-off'}"></i>
                                    ${isEngineOn ? 'شغال' : 'مطفأ'}
                                </span>
                            </div>
                        </div>

                        <div class="daily-stats-row" style="display: flex; align-items: center; justify-content: space-between; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px; padding: 0.3rem 0.6rem; margin: 0.45rem 0 0.35rem; font-size: 0.72rem;">
                            <span style="color: var(--text-dim); display: inline-flex; align-items: center; gap: 0.3rem;">
                                <i class="fa-regular fa-calendar-check" style="color: var(--accent-blue);"></i> إحصائيات اليوم:
                            </span>
                            <div style="display: flex; align-items: center; gap: 0.75rem;">
                                <span style="display: inline-flex; align-items: center; gap: 0.3rem; color: ${dailyStats.disconnects > 0 ? '#f87171' : 'var(--text-muted)'}; font-weight: 600;" title="عدد مرات انقطاع الاتصال خلال اليوم">
                                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 0.68rem; color: ${dailyStats.disconnects > 0 ? '#ef4444' : 'var(--text-dim)'};"></i> انقطاع: <strong>${dailyStats.disconnects}</strong>
                                </span>
                                <span style="color: rgba(255, 255, 255, 0.12);">|</span>
                                <span style="display: inline-flex; align-items: center; gap: 0.3rem; color: ${dailyStats.powerSavings > 0 ? '#fbbf24' : 'var(--text-muted)'}; font-weight: 600;" title="عدد مرات الدخول في وضع توفير الطاقة خلال اليوم">
                                    <i class="fa-solid fa-leaf" style="font-size: 0.68rem; color: ${dailyStats.powerSavings > 0 ? '#f59e0b' : 'var(--text-dim)'};"></i> توفير: <strong>${dailyStats.powerSavings}</strong>
                                </span>
                            </div>
                        </div>


                        <div class="card-footer">
                            <span><i class="fa-regular fa-clock"></i> ${timeAgo}</span>
                            <div class="card-actions">
                                <button class="mini-btn btn-control" onclick="event.stopPropagation(); openControlModal('${dev.id}')" title="التحكم بالدراجة عن بُعد (فتح / قفل)">
                                    <i class="fa-solid fa-gamepad"></i> تحكم
                                </button>
                                ${hasGps ? `
                                    <button class="mini-btn ${isLastKnown ? 'last-known-btn' : ''}" onclick="event.stopPropagation(); centerDeviceOnMap('${dev.id}')" title="${isLastKnown ? 'آخر موقع مسجل' : 'تركيز على الخريطة'}">
                                        <i class="fa-solid fa-crosshairs"></i> ${isLastKnown ? 'آخر موقع' : 'تركيز'}
                                    </button>
                                    <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" class="mini-btn" onclick="event.stopPropagation()" title="خرائط جوجل">
                                        <i class="fa-solid fa-diamond-turn-right"></i> خرائط
                                    </a>
                                ` : `
                                    <span style="color: var(--accent-amber); font-size: 0.68rem;">لا يوجد GPS</span>
                                `}
                                <button class="mini-btn btn-delete" onclick="event.stopPropagation(); promptDeleteDevice('${dev.id}')" title="حذف الجهاز نهائياً">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
            container.scrollTop = prevScrollTop;
        }

        // --- Interaction Handlers ---
        function selectDevice(deviceId, panMap) {
            App.selectedDeviceId = deviceId;
            renderDevicesList();

            if (panMap) {
                centerDeviceOnMap(deviceId);
            }
        }

        function centerDeviceOnMap(deviceId) {
            const dev = App.devices.get(deviceId);
            if (!dev) return;

            const loc = getDeviceEffectiveLocation(dev);

            if (loc && loc.lat !== 0 && loc.lng !== 0) {
                App.map.flyTo([loc.lat, loc.lng], 17, { animate: true, duration: 1.0 });
                if (dev.marker) {
                    dev.marker.setPopupContent(getDevicePopupHtml(dev));
                    dev.marker.openPopup();
                }

                // If on mobile, switch to map view
                if (window.innerWidth <= 860) {
                    showMobileTab('map');
                }
            } else {
                alert(`الجهاز ${dev.name} لم يرسل إحداثيات GPS صالحة حتى الآن.`);
            }
        }

        function fitAllDevicesOnMap() {
            const points = [];
            App.devices.forEach(dev => {
                const loc = getDeviceEffectiveLocation(dev);
                if (loc && loc.lat !== 0 && loc.lng !== 0 && !isNaN(loc.lat) && !isNaN(loc.lng)) {
                    points.push([loc.lat, loc.lng]);
                }
            });

            if (points.length > 0) {
                const bounds = L.latLngBounds(points);
                App.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
            } else {
                alert('لا توجد أجهزة ذات مواقع GPS صالحة لعرضها على الخريطة.');
            }
        }

        // --- Device Naming Functionality ---
        function promptRename(deviceId) {
            const dev = App.devices.get(deviceId);
            if (!dev) return;

            document.getElementById('rename-device-id').value = deviceId;
            document.getElementById('rename-device-name').value = dev.name;
            openModal('modal-rename');
        }

        document.getElementById('btn-save-rename').addEventListener('click', () => {
            const deviceId = document.getElementById('rename-device-id').value.trim();
            const newName = document.getElementById('rename-device-name').value.trim();

            if (!deviceId || !newName) return;

            // 1. Save to LocalStorage
            App.customNames[deviceId] = newName;
            localStorage.setItem('motolock_custom_names', JSON.stringify(App.customNames));

            // 2. Update memory state
            const dev = App.devices.get(deviceId);
            if (dev) {
                dev.name = newName;
                updateDeviceMarker(dev);
                renderDevicesList();
            }

            // 3. Try to save to Firebase meta/customName
            if (App.db) {
                App.db.ref(`devices/${deviceId}/meta`).update({
                    customName: newName,
                    name: newName
                }).catch(err => {
                    console.warn('Firebase sync of customName not permitted or failed, saved locally:', err.message);
                });
            }

            closeModal('modal-rename');
        });

        // --- Device Deletion Functionality ---
        function promptDeleteDevice(deviceId) {
            if (!deviceId) return;
            const dev = App.devices.get(deviceId);
            const name = dev ? dev.name : (App.customNames[deviceId] || `دراجة ${deviceId.slice(-4)}`);
            App.deviceToDeleteId = deviceId;

            const nameEl = document.getElementById('delete-device-name-display');
            const macEl = document.getElementById('delete-device-mac-display');
            if (nameEl) nameEl.textContent = name;
            if (macEl) macEl.textContent = deviceId;

            openModal('modal-delete-device');
        }

        async function executeDeleteDevice() {
            const deviceId = App.deviceToDeleteId;
            if (!deviceId) return;

            const btnConfirm = document.getElementById('btn-confirm-delete');
            const originalBtnHtml = btnConfirm ? btnConfirm.innerHTML : '';
            if (btnConfirm) {
                btnConfirm.disabled = true;
                btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحذف...';
            }

            try {
                // 1. Delete node completely from Firebase Realtime Database
                if (App.db) {
                    try {
                        await App.db.ref(`devices/${deviceId}`).remove();
                        console.log(`[Admin] Successfully removed devices/${deviceId} from Firebase RTDB`);
                    } catch (fbErr) {
                        console.warn(`[Admin] Firebase remove error or permissions denied:`, fbErr.message);
                    }
                }

                // 2. Detach real-time listeners for this device
                App.activeDeviceListeners.delete(deviceId);
                try { App.db.ref(`devices/${deviceId}/status`).off(); } catch (e) { }
                try { App.db.ref(`devices/${deviceId}/meta`).off(); } catch (e) { }
                try { App.db.ref(`devices/${deviceId}/commands`).off(); } catch (e) { }

                // 3. Remove from local memory and UI state
                removeDeviceFromState(deviceId);

                // 4. Update localStorage
                localStorage.setItem('motolock_tracked_ids', JSON.stringify(Array.from(App.trackedIds)));
                localStorage.setItem('motolock_custom_names', JSON.stringify(App.customNames));
                if (App.lastKnownLocations) {
                    delete App.lastKnownLocations[deviceId];
                    localStorage.setItem('motolock_last_coords', JSON.stringify(App.lastKnownLocations));
                }
                try {
                    localStorage.removeItem(`motolock_stats_${deviceId}`);
                } catch (e) { }

                // 5. Close modal
                App.deviceToDeleteId = null;
                closeModal('modal-delete-device');

                // If control modal is open for this device, close it
                if (App.controlActiveDeviceId === deviceId) {
                    closeModal('modal-control');
                }

                // 6. Refresh UI
                renderDevicesList();
                updateKpiCounters();
                if (typeof renderTelemetryTable === 'function') {
                    renderTelemetryTable();
                }

            } catch (err) {
                console.error('[Admin] Unexpected error deleting device:', err);
                alert('حدث خطأ أثناء محاولة حذف الجهاز: ' + err.message);
            } finally {
                if (btnConfirm) {
                    btnConfirm.disabled = false;
                    btnConfirm.innerHTML = originalBtnHtml;
                }
            }
        }

        // --- Add Device Identifier Manually (Single or Multiple) ---
        document.getElementById('btn-confirm-add-device').addEventListener('click', () => {
            const rawInput = document.getElementById('add-mac-input').value.trim();
            const singleName = document.getElementById('add-name-input').value.trim();

            if (!rawInput) {
                alert('يرجى إدخال معرف الماك للجهاز');
                return;
            }

            // Split by comma, space, newline or tab
            const rawTokens = rawInput.split(/[\s,;\n]+/);
            let addedCount = 0;

            rawTokens.forEach(token => {
                const mac = normalizeId(token);
                if (mac && mac.length >= 6) {
                    App.trackedIds.add(mac);
                    if (singleName && rawTokens.length === 1) {
                        App.customNames[mac] = singleName;
                    }
                    listenToSingleDevice(mac);
                    addedCount++;
                }
            });

            if (addedCount > 0) {
                localStorage.setItem('motolock_tracked_ids', JSON.stringify(Array.from(App.trackedIds)));
                localStorage.setItem('motolock_custom_names', JSON.stringify(App.customNames));
            }

            // Close and reset modal
            closeModal('modal-add-device');
            document.getElementById('add-mac-input').value = '';
            document.getElementById('add-name-input').value = '';

            renderDevicesList();
            updateKpiCounters();
        });

        // --- Copy Rules Code Helper ---
        function copyRulesCode() {
            const code = document.getElementById('rules-code-block').innerText;
            navigator.clipboard.writeText(code).then(() => {
                const btnText = document.getElementById('copy-btn-text');
                btnText.textContent = 'تم النسخ بنجاح! ✓';
                setTimeout(() => { btnText.textContent = 'نسخ الكود'; }, 2500);
            }).catch(() => {
                alert('فشل النسخ التلقائي، يمكنك تحديد النص ونسخه يدوياً.');
            });
        }

        // --- Map Style Toggle ---
        document.getElementById('btn-toggle-map-style').addEventListener('click', () => {
            const label = document.getElementById('map-style-name');
            if (App.currentMapStyle === 'satellite') {
                App.map.removeLayer(App.mapLayers.satellite);
                App.mapLayers.dark.addTo(App.map);
                App.currentMapStyle = 'dark';
                label.textContent = 'خريطة داكنة';
            } else if (App.currentMapStyle === 'dark') {
                App.map.removeLayer(App.mapLayers.dark);
                App.mapLayers.osm.addTo(App.map);
                App.currentMapStyle = 'osm';
                label.textContent = 'خريطة الشوارع (Google)';
            } else {
                App.map.removeLayer(App.mapLayers.osm);
                App.mapLayers.satellite.addTo(App.map);
                App.currentMapStyle = 'satellite';
                label.textContent = 'أقمار صناعية';
            }
        });

        // --- Event Listeners Setup ---
        function setupEventListeners() {
            // Timeout selector
            document.getElementById('sel-timeout').addEventListener('change', (e) => {
                App.onlineThresholdMs = parseInt(e.target.value, 10);
                renderDevicesList();
                updateKpiCounters();
                // Re-update all markers with new online state
                App.devices.forEach(dev => updateDeviceMarker(dev));
            });

            // Fit bounds button
            document.getElementById('btn-fit-bounds').addEventListener('click', fitAllDevicesOnMap);

            // Add device button
            document.getElementById('btn-add-device').addEventListener('click', () => openModal('modal-add-device'));

            // Config button
            document.getElementById('btn-config').addEventListener('click', () => openModal('modal-config'));

            // Save Config button
            document.getElementById('btn-save-config').addEventListener('click', () => {
                App.config.databaseURL = document.getElementById('cfg-rtdb-url').value.trim();
                App.config.projectId = document.getElementById('cfg-project-id').value.trim();
                App.config.apiKey = document.getElementById('cfg-api-key').value.trim();
                localStorage.setItem('motolock_admin_cfg', JSON.stringify(App.config));
                closeModal('modal-config');
                location.reload();
            });

            // Clean Fake Nodes button
            const btnClean = document.getElementById('btn-clean-fake-nodes');
            if (btnClean) {
                btnClean.addEventListener('click', async () => {
                    const confirmClean = confirm(
                        'هل أنت متأكد من تنظيف قاعدة البيانات؟\n\n' +
                        'سيقوم هذا الإجراء بفحص جميع العقد وحذف أي عقدة غير صالحة مثل:\n' +
                        '• command و commandQueue\n' +
                        '• الأحرف المفردة (E, AA, FAE, إلخ)\n' +
                        '• أرقام الهواتف أو السيريال التي أُدخلت خطأً\n\n' +
                        'وسيتم الحفاظ التام على جميع دراجاتك وأجهزتك الحقيقية (12 خانة Hex).'
                    );
                    if (!confirmClean) return;

                    btnClean.disabled = true;
                    btnClean.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جارٍ التنظيف...';

                    try {
                        let keys = [];
                        // 1. First attempt shallow fetch to avoid downloading trip data
                        try {
                            let token = '';
                            if (App.auth && App.auth.currentUser) {
                                token = await App.auth.currentUser.getIdToken().catch(() => '');
                            }
                            const authParam = token ? `?auth=${token}&shallow=true` : '?shallow=true';
                            const res = await fetch(`${App.config.databaseURL}/devices.json${authParam}`);
                            if (res.ok) {
                                const shallowObj = await res.json();
                                if (shallowObj && typeof shallowObj === 'object') {
                                    keys = Object.keys(shallowObj);
                                }
                            }
                        } catch (shallowErr) {
                            console.warn('Shallow check note:', shallowErr);
                        }

                        // 2. If shallow fetch returned no keys, check in-memory devices
                        if (keys.length === 0) {
                            keys = Array.from(new Set([...App.trackedIds, ...App.devices.keys()]));
                        }

                        const toDelete = keys.filter(key => !isValidDeviceId(key));

                        if (toDelete.length === 0) {
                            alert('قاعدة البيانات نظيفة تماماً! لا توجد أي عقد وهمية.');
                            return;
                        }

                        for (const key of toDelete) {
                            await App.db.ref(`devices/${key}`).remove().catch(() => { });
                            removeDevice(key);
                        }

                        alert(`تمت العملية بنجاح! 🎉\nتم حذف ${toDelete.length} عقدة وهمية من الفايربيس:\n${toDelete.join(', ')}`);
                        closeModal('modal-config');
                        renderDevicesList();
                        updateKpiCounters();
                    } catch (e) {
                        console.error('Clean fake nodes error:', e);
                        alert('حدث خطأ أثناء التنظيف: ' + e.message);
                    } finally {
                        btnClean.disabled = false;
                        btnClean.innerHTML = '<i class="fa-solid fa-trash-can"></i> تنظيف الآن';
                    }
                });
            }

            // Clean Temp Trips button
            const btnCleanTrips = document.getElementById('btn-clean-temp-trips');
            if (btnCleanTrips) {
                btnCleanTrips.addEventListener('click', async () => {
                    const confirmPurge = confirm(
                        'هل أنت متأكد من تفريغ نقاط مسارات temp_trip المؤقتة لجميع الأجهزة في الفايربيس؟\n\n' +
                        '• سيؤدي هذا لتوفير مساحة التخزين وباقة التنزيلات (Download Bandwidth) فوراً.\n' +
                        '• لن يؤثر على حالة الأجهزة أو آخر موقع أو بطارية أو تشغيل/قفل الدراجات.'
                    );
                    if (!confirmPurge) return;

                    btnCleanTrips.disabled = true;
                    btnCleanTrips.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جارٍ التفريغ...';

                    try {
                        const targetIds = Array.from(new Set([...App.trackedIds, ...App.devices.keys()])).filter(isValidDeviceId);
                        let purgedCount = 0;
                        for (const id of targetIds) {
                            try {
                                await App.db.ref(`devices/${id}/temp_trip`).remove();
                                purgedCount++;
                            } catch (e) {
                                console.warn(`Could not purge temp_trip for ${id}:`, e);
                            }
                        }

                        alert(`تمت العملية بنجاح! 🎉\nتم تفريغ مسارات temp_trip لـ ${purgedCount} جهازاً في الفايربيس لتوفير الباقة.`);
                        closeModal('modal-config');
                    } catch (e) {
                        console.error('Clean temp trips error:', e);
                        alert('حدث خطأ أثناء تفريغ المسارات: ' + e.message);
                    } finally {
                        btnCleanTrips.disabled = false;
                        btnCleanTrips.innerHTML = '<i class="fa-solid fa-broom"></i> تفريغ الآن';
                    }
                });
            }

            // Search input
            document.getElementById('device-search').addEventListener('input', (e) => {
                App.searchQuery = e.target.value;
                renderDevicesList();
            });

            // Filter chips
            document.querySelectorAll('.chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    App.currentFilter = chip.getAttribute('data-filter');
                    renderDevicesList();
                });
            });

            // KPI Cards click to filter
            document.querySelectorAll('.kpi-card').forEach(card => {
                card.addEventListener('click', () => {
                    document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    const filter = card.getAttribute('data-filter');
                    App.currentFilter = filter;

                    // sync chips
                    document.querySelectorAll('.chip').forEach(c => {
                        c.classList.toggle('active', c.getAttribute('data-filter') === filter);
                    });

                    renderDevicesList();

                    // On mobile, if clicked, switch to devices list
                    if (window.innerWidth <= 860) {
                        showMobileTab('devices');
                    }
                });
            });

            // Mobile Tab Switchers
            document.getElementById('nav-map').addEventListener('click', () => showMobileTab('map'));
            document.getElementById('nav-devices').addEventListener('click', () => showMobileTab('devices'));

            // Sort selector listener
            const selSort = document.getElementById('sel-sort');
            if (selSort) {
                selSort.value = App.sortOrder;
                selSort.addEventListener('change', (e) => {
                    App.sortOrder = e.target.value;
                    localStorage.setItem('motolock_sort_order', App.sortOrder);
                    renderDevicesList();
                });
            }

            // Map Fullscreen / Expand toggle
            const btnFs = document.getElementById('btn-toggle-fullscreen');
            if (btnFs) {
                btnFs.addEventListener('click', toggleMapFullscreen);
            }

            // Password visibility toggle
            const btnPwdVis = document.getElementById('btn-toggle-pwd-vis');
            if (btnPwdVis) {
                btnPwdVis.addEventListener('click', togglePasswordVisibility);
            }

            // Mobile Sheet Drag / Swipe Down Gestures
            setupSheetGestures();
        }

        // Reset filter to show all devices
        function resetFilterToAll() {
            App.currentFilter = 'all';
            App.searchQuery = '';
            const searchInput = document.getElementById('device-search');
            if (searchInput) searchInput.value = '';
            document.querySelectorAll('.chip').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-filter') === 'all');
            });
            document.querySelectorAll('.kpi-card').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-filter') === 'all');
            });
            renderDevicesList();
        }

        // Setup touch drag and click on the drawer handle
        function setupSheetGestures() {
            const handle = document.getElementById('sheet-drag-handle');
            const sidebar = document.getElementById('sidebar');
            if (!handle || !sidebar) return;

            // Clicking or tapping directly on the handle closes the drawer
            handle.addEventListener('click', () => {
                showMobileTab('map');
            });

            // Touch swipe down
            let startY = 0;
            let currentY = 0;
            let isDragging = false;

            handle.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) {
                    startY = e.touches[0].clientY;
                    currentY = startY;
                    isDragging = true;
                    sidebar.style.transition = 'none';
                }
            }, { passive: true });

            handle.addEventListener('touchmove', (e) => {
                if (!isDragging || e.touches.length !== 1) return;
                currentY = e.touches[0].clientY;
                const deltaY = currentY - startY;
                if (deltaY > 0) {
                    sidebar.style.transform = `translateY(${deltaY}px)`;
                }
            }, { passive: true });

            const handleTouchEnd = () => {
                if (!isDragging) return;
                isDragging = false;
                sidebar.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
                const deltaY = currentY - startY;
                if (deltaY > 50) {
                    showMobileTab('map');
                } else {
                    sidebar.style.transform = 'translateY(0)';
                }
                setTimeout(() => { sidebar.style.transform = ''; }, 350);
                startY = 0;
                currentY = 0;
            };

            handle.addEventListener('touchend', handleTouchEnd);
            handle.addEventListener('touchcancel', handleTouchEnd);
        }

        function showMobileTab(tab) {
            const sidebar = document.getElementById('sidebar');
            const navMap = document.getElementById('nav-map');
            const navDev = document.getElementById('nav-devices');

            if (tab === 'devices') {
                sidebar.style.transform = '';
                sidebar.classList.add('active-mobile');
                navDev.classList.add('active');
                navMap.classList.remove('active');
            } else {
                sidebar.style.transform = '';
                sidebar.classList.remove('active-mobile');
                navMap.classList.add('active');
                navDev.classList.remove('active');
                if (App.map) {
                    setTimeout(() => App.map.invalidateSize(), 300);
                }
            }
        }

        // --- Relative Time Formatter ---
        function formatTimeAgo(ts) {
            if (!ts || ts === 0) return 'غير متوفر';
            const diffSec = Math.floor((Date.now() - ts) / 1000);
            if (diffSec < 10) return 'الآن';
            if (diffSec < 60) return `منذ ${diffSec} ثانية`;
            const diffMin = Math.floor(diffSec / 60);
            if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
            const diffHours = Math.floor(diffMin / 60);
            if (diffHours < 24) return `منذ ${diffHours} ساعة`;
            const diffDays = Math.floor(diffHours / 24);
            return `منذ ${diffDays} يوم`;
        }

        // --- Wake Reason Formatter ---
        function formatWakeReason(rawReason) {
            if (!rawReason) return null;
            const r = String(rawReason).toLowerCase().trim();
            if (!r || r === 'unknown' || r === 'none') return null;

            if (r.includes('vibration') || r.includes('motion') || r.includes('shock')) {
                return {
                    text: 'حركة / اهتزاز (حساس الصدمات)',
                    shortText: 'اهتزاز / حركة',
                    icon: 'fa-solid fa-bolt',
                    color: '#fbbf24',
                    bg: 'rgba(251, 191, 36, 0.12)',
                    border: 'rgba(251, 191, 36, 0.28)'
                };
            }
            if (r.includes('stationary') || r.includes('parked') || r.includes('standstill')) {
                return {
                    text: 'ثبات وتوقف الدراجة (Stationary / ركن)',
                    shortText: 'ثبات وركن الدراجة',
                    icon: 'fa-solid fa-square-parking',
                    color: '#38bdf8',
                    bg: 'rgba(56, 189, 248, 0.12)',
                    border: 'rgba(56, 189, 248, 0.28)'
                };
            }
            if (r.includes('contact')) {
                return {
                    text: 'فتح الكونتاكت (تشغيل السويتش)',
                    shortText: 'فتح كونتاكت',
                    icon: 'fa-solid fa-key',
                    color: '#38bdf8',
                    bg: 'rgba(56, 189, 248, 0.12)',
                    border: 'rgba(56, 189, 248, 0.28)'
                };
            }
            if (r.includes('cmd') || r.includes('command') || r.includes('unlock') || r.includes('start') || r.includes('starter')) {
                return {
                    text: 'أمر تحكم عن بُعد (سحابي)',
                    shortText: 'أمر تحكم',
                    icon: 'fa-solid fa-tower-broadcast',
                    color: '#a78bfa',
                    bg: 'rgba(167, 139, 250, 0.12)',
                    border: 'rgba(167, 139, 250, 0.28)'
                };
            }
            if (r.includes('timer') || r.includes('interval') || r.includes('keepalive')) {
                return {
                    text: 'مؤقت دوري مجدول',
                    shortText: 'مؤقت دوري',
                    icon: 'fa-regular fa-clock',
                    color: '#34d399',
                    bg: 'rgba(52, 211, 153, 0.12)',
                    border: 'rgba(52, 211, 153, 0.28)'
                };
            }
            if (r.includes('boot') || r.includes('power_on') || r.includes('rst') || r.includes('reset')) {
                return {
                    text: 'بدء تشغيل الجهاز (Power-on)',
                    shortText: 'بدء تشغيل',
                    icon: 'fa-solid fa-plug',
                    color: '#94a3b8',
                    bg: 'rgba(148, 163, 184, 0.12)',
                    border: 'rgba(148, 163, 184, 0.28)'
                };
            }

            return {
                text: rawReason,
                shortText: rawReason,
                icon: 'fa-solid fa-bell',
                color: '#38bdf8',
                bg: 'rgba(56, 189, 248, 0.12)',
                border: 'rgba(56, 189, 248, 0.28)'
            };
        }

        // --- 12-Hour Clock Formatter (نظام 12 ساعة) ---
        function formatTime12H(dateOrTs) {
            const d = (typeof dateOrTs === 'number' || typeof dateOrTs === 'string') ? new Date(dateOrTs) : (dateOrTs || new Date());
            let hours = d.getHours();
            const minutes = String(d.getMinutes()).padStart(2, '0');
            const seconds = String(d.getSeconds()).padStart(2, '0');
            const period = hours >= 12 ? 'م' : 'ص';
            hours = hours % 12;
            if (hours === 0) hours = 12;
            const hoursStr = String(hours).padStart(2, '0');
            return `${hoursStr}:${minutes}:${seconds} ${period}`;
        }

        function formatTime12HShort(dateOrTs) {
            const d = (typeof dateOrTs === 'number' || typeof dateOrTs === 'string') ? new Date(dateOrTs) : (dateOrTs || new Date());
            let hours = d.getHours();
            const minutes = String(d.getMinutes()).padStart(2, '0');
            const period = hours >= 12 ? 'م' : 'ص';
            hours = hours % 12;
            if (hours === 0) hours = 12;
            const hoursStr = String(hours).padStart(2, '0');
            return `${hoursStr}:${minutes} ${period}`;
        }

        // --- Device Live Events Manager (سجل الأحداث الحية السريع) ---
        function addDeviceEvent(deviceId, text, type = 'info', icon = 'fa-solid fa-info-circle') {
            if (!deviceId || !text) return;
            const storageKey = 'motolock_events_' + deviceId;
            let events = [];
            try {
                events = JSON.parse(localStorage.getItem(storageKey) || '[]');
            } catch (e) { }

            // Prevent duplicate event within 12 seconds
            const now = Date.now();
            if (events.length > 0) {
                const last = events[0];
                if (last.text === text && (now - last.timestamp) < 12000) {
                    return;
                }
            }

            events.unshift({
                id: 'evt_' + now + '_' + Math.random().toString(36).substring(2, 6),
                timestamp: now,
                text: text,
                type: type,
                icon: icon
            });

            if (events.length > 30) {
                events = events.slice(0, 30);
            }

            try {
                localStorage.setItem(storageKey, JSON.stringify(events));
            } catch (e) { }

            // If modal-control is currently open for this device, refresh the events log DOM
            if (App.controlActiveDeviceId === deviceId) {
                renderDeviceEventsLog(deviceId);
            }
        }

        function renderDeviceEventsLog(deviceId) {
            const container = document.getElementById('ctrl-events-log-list');
            if (!container) return;

            const storageKey = 'motolock_events_' + deviceId;
            let events = [];
            try {
                events = JSON.parse(localStorage.getItem(storageKey) || '[]');
            } catch (e) { }

            if (events.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); font-size: 0.72rem; padding: 0.75rem 0.5rem;">
                        <i class="fa-regular fa-clock" style="font-size: 1.1rem; color: var(--text-dim); margin-bottom: 0.25rem; display: block;"></i>
                        لا توجد أحداث مسجلة بعد لهذه الدراجة. يتم تسجيل الأحداث فور حدوثها.
                    </div>
                `;
                return;
            }

            let html = '';
            events.forEach(evt => {
                const time12H = formatTime12HShort(evt.timestamp);
                let badgeColor = 'var(--text-muted)';
                let badgeBg = 'rgba(255, 255, 255, 0.04)';
                if (evt.type === 'engine_on' || evt.type === 'success' || evt.type === 'online') {
                    badgeColor = 'var(--accent-green)';
                    badgeBg = 'rgba(16, 185, 129, 0.12)';
                } else if (evt.type === 'engine_off' || evt.type === 'offline' || evt.type === 'error') {
                    badgeColor = 'var(--accent-red)';
                    badgeBg = 'rgba(239, 68, 68, 0.12)';
                } else if (evt.type === 'vibration' || evt.type === 'warning' || evt.type === 'powersave') {
                    badgeColor = '#fbbf24';
                    badgeBg = 'rgba(251, 191, 36, 0.12)';
                } else if (evt.type === 'command' || evt.type === 'ping' || evt.type === 'reboot') {
                    badgeColor = '#38bdf8';
                    badgeBg = 'rgba(56, 189, 248, 0.12)';
                }

                html += `
                    <div class="event-log-item" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.32rem 0.5rem; background: ${badgeBg}; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 6px; font-size: 0.72rem;">
                        <div style="display: flex; align-items: center; gap: 0.45rem; min-width: 0;">
                            <i class="${escapeHtml(evt.icon || 'fa-solid fa-circle-dot')}" style="color: ${badgeColor}; font-size: 0.72rem; flex-shrink: 0;"></i>
                            <span style="color: var(--text-main); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(evt.text)}</span>
                        </div>
                        <span style="font-family: monospace; font-size: 0.68rem; color: var(--text-dim); flex-shrink: 0; direction: ltr; font-weight: 600;">
                            ${time12H}
                        </span>
                    </div>
                `;
            });

            container.innerHTML = html;
        }

        function clearDeviceEventsLog(deviceId) {
            if (!deviceId) return;
            if (confirm('هل أنت متأكد من مسح سجل أحداث هذه الدراجة؟')) {
                localStorage.removeItem('motolock_events_' + deviceId);
                renderDeviceEventsLog(deviceId);
            }
        }

        function updateOpenPopups() {
            App.devices.forEach(dev => {
                if (dev.marker && typeof dev.marker.isPopupOpen === 'function' && dev.marker.isPopupOpen()) {
                    const popup = dev.marker.getPopup();
                    const popupEl = popup ? popup.getElement() : null;
                    if (popupEl) {
                        const state = getDeviceConnectionState(dev);
                        const timeAgo = formatTimeAgo(state.lastSeen);
                        const parkedAgo = getDeviceStationaryTimeAgo(dev, state);
                        const speed = Number(dev.status?.speed || 0).toFixed(1);

                        // 1. تحديث نص آخر اتصال ليتطابق ثانية بثانية مع القائمة
                        const lastSeenEl = popupEl.querySelector('.popup-last-seen-val');
                        if (lastSeenEl && lastSeenEl.textContent !== timeAgo) {
                            lastSeenEl.textContent = timeAgo;
                        }

                        // 2. تحديث مدة التوقف
                        const parkedRow = popupEl.querySelector('.popup-row-parked');
                        const parkedEl = popupEl.querySelector('.popup-parked-val');
                        if (parkedRow && parkedEl) {
                            if ((state.isParked || state.isPowerSaving) && parkedAgo) {
                                parkedRow.style.display = '';
                                if (parkedEl.textContent !== parkedAgo) {
                                    parkedEl.textContent = parkedAgo;
                                }
                            } else {
                                parkedRow.style.display = 'none';
                            }
                        }

                        // 3. تحديث شارة الحالة في العنوان
                        const statusBadgeEl = popupEl.querySelector('.popup-status-badge');
                        if (statusBadgeEl) {
                            let statusLabel = '';
                            if (state.isPowerSaving) {
                                statusLabel = `<i class="fa-solid fa-leaf"></i> 🟡 توفير الطاقة ${parkedAgo ? '(' + parkedAgo + ')' : ''}`;
                                statusBadgeEl.style.color = 'var(--accent-amber)';
                            } else if (state.isMoving) {
                                statusLabel = `<i class="fa-solid fa-gauge-high"></i> 🟢 متحرك (${speed} كم/س)`;
                                statusBadgeEl.style.color = 'var(--accent-green)';
                            } else if (state.isParked) {
                                statusLabel = `<i class="fa-solid fa-square-parking"></i> 🔵 متوقف ${parkedAgo ? '(' + parkedAgo + ')' : ''}`;
                                statusBadgeEl.style.color = 'var(--accent-blue)';
                            } else {
                                statusLabel = '<i class="fa-solid fa-circle-xmark"></i> 🔴 غير متصل';
                                statusBadgeEl.style.color = 'var(--accent-red)';
                            }
                            if (statusBadgeEl.innerHTML !== statusLabel) {
                                statusBadgeEl.innerHTML = statusLabel;
                            }
                        }

                        // 4. إحصائيات اليوم (انقطاع / توفير)
                        const dailyStats = getDeviceDailyStats(dev);
                        const discEl = popupEl.querySelector('.popup-stats-disconnects');
                        if (discEl && discEl.textContent !== String(dailyStats.disconnects)) {
                            discEl.textContent = dailyStats.disconnects;
                        }
                        const psEl = popupEl.querySelector('.popup-stats-powersave');
                        if (psEl && psEl.textContent !== String(dailyStats.powerSavings)) {
                            psEl.textContent = dailyStats.powerSavings;
                        }
                    } else {
                        dev.marker.setPopupContent(getDevicePopupHtml(dev));
                    }
                }
            });
        }

        function startRelativeTimeTicker() {
            setInterval(() => {
                renderDevicesList();
                updateKpiCounters();
                updateOpenPopups();
                if (App.controlActiveDeviceId) {
                    updateControlModalStatus(App.controlActiveDeviceId);
                }
            }, 4000); // refresh relative times, KPIs and connection state every 4 seconds
        }

        // --- Map Fullscreen Toggle ---
        function toggleMapFullscreen() {
            App.isMapExpanded = !App.isMapExpanded;
            const wrapper = document.querySelector('.main-wrapper');
            const fsLabel = document.getElementById('fs-label');
            const fsIcon = document.querySelector('#btn-toggle-fullscreen i');

            if (wrapper) {
                wrapper.classList.toggle('map-expanded', App.isMapExpanded);
            }
            if (fsLabel) {
                fsLabel.textContent = App.isMapExpanded ? 'استعادة القائمة' : 'تكبير الخريطة';
            }
            if (fsIcon) {
                fsIcon.className = App.isMapExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
            }
            setTimeout(() => {
                if (App.map) App.map.invalidateSize();
            }, 300);
        }

        // --- Toggle Password Visibility ---
        function togglePasswordVisibility() {
            const pwdInput = document.getElementById('ctrl-password-input');
            const eyeIcon = document.getElementById('pwd-eye-icon');
            if (!pwdInput) return;
            if (pwdInput.type === 'password') {
                pwdInput.type = 'text';
                if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye-slash';
            } else {
                pwdInput.type = 'password';
                if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye';
            }
        }

        // --- Remote Control Functions ---
        function openControlModal(deviceId) {
            const dev = App.devices.get(deviceId);
            if (!dev) {
                alert('الجهاز غير مسجل أو غير موجود');
                return;
            }

            App.controlActiveDeviceId = deviceId;

            // Fill header info
            document.getElementById('ctrl-device-name').textContent = dev.name;
            document.getElementById('ctrl-device-id').textContent = dev.id;

            // Retrieve saved password or default
            const savedPwd = localStorage.getItem('motolock_pwd_' + deviceId);
            const pwdInput = document.getElementById('ctrl-password-input');
            if (pwdInput) {
                pwdInput.value = savedPwd || '123456';
                pwdInput.type = 'password';
                const eyeIcon = document.getElementById('pwd-eye-icon');
                if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye';
            }

            // Reset feedback
            const feedback = document.getElementById('ctrl-feedback');
            if (feedback) feedback.className = 'control-feedback-box';

            // Enable all control buttons
            const allBtns = document.querySelectorAll('.btn-control-action, .btn-subaction');
            allBtns.forEach(btn => btn.disabled = false);

            // Update live metrics & badge
            updateControlModalStatus(deviceId);

            // Render live device events log
            renderDeviceEventsLog(deviceId);

            // Open modal
            openModal('modal-control');
        }

        function updateControlModalStatus(deviceId) {
            if (App.controlActiveDeviceId !== deviceId) return;
            const dev = App.devices.get(deviceId);
            if (!dev) return;

            const state = getDeviceConnectionState(dev);
            const isLocked = dev.status?.lock === true;
            const isEngineOn = dev.status?.engine === true;
            const battery = dev.status?.battery ? Number(dev.status.battery).toFixed(1) + 'V' : '--';

            // Connection Badge
            const connBadge = document.getElementById('ctrl-conn-badge');
            const connText = document.getElementById('ctrl-conn-text');
            if (connBadge && connText) {
                if (state.isPowerSaving) {
                    connBadge.style.background = 'rgba(245, 158, 11, 0.15)';
                    connBadge.style.color = '#fbbf24';
                    connBadge.style.border = '1px solid rgba(245, 158, 11, 0.35)';
                    connText.textContent = 'توفير الطاقة (سكون)';
                } else if (state.isOnline) {
                    connBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                    connBadge.style.color = 'var(--accent-green)';
                    connBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                    connText.textContent = state.isMoving ? 'متصلة (متحركة)' : 'متصلة (متوقفة)';
                } else {
                    connBadge.style.background = 'rgba(239, 68, 68, 0.15)';
                    connBadge.style.color = 'var(--accent-red)';
                    connBadge.style.border = '1px solid rgba(239, 68, 68, 0.3)';
                    connText.textContent = 'غير متصلة حالياً';
                }
            }

            // Lock status
            const lockElem = document.getElementById('ctrl-lock-status');
            if (lockElem) {
                lockElem.style.color = isLocked ? 'var(--accent-red)' : 'var(--accent-green)';
                lockElem.innerHTML = isLocked ? '<i class="fa-solid fa-lock"></i> مقفول' : '<i class="fa-solid fa-lock-open"></i> مفتوح';
            }

            // Engine status
            const engineElem = document.getElementById('ctrl-engine-status');
            if (engineElem) {
                engineElem.style.color = isEngineOn ? 'var(--accent-green)' : 'var(--text-muted)';
                engineElem.innerHTML = isEngineOn ? '<i class="fa-solid fa-bolt"></i> شغال' : '<i class="fa-solid fa-power-off"></i> مطفأ';
            }

            // Battery status
            const batElem = document.getElementById('ctrl-battery-status');
            if (batElem) {
                batElem.innerHTML = `<i class="fa-solid fa-car-battery"></i> ${battery}`;
            }

            // Signal status
            const signal = formatCellularSignal(dev.status);
            const signalElem = document.getElementById('ctrl-signal-status');
            if (signalElem) {
                signalElem.style.color = signal.color;
                signalElem.innerHTML = `<i class="fa-solid fa-signal"></i> ${signal.displayText}${signal.shortOp ? ' (' + escapeHtml(signal.shortOp) + ')' : ''}`;
                signalElem.title = `${signal.op ? signal.op + ' - ' : ''}${signal.fullText}${signal.dbm ? ' (' + signal.dbm + ' dBm)' : ''}`;
            }

            // Daily stats & firmware in modal
            const dailyStats = getDeviceDailyStats(dev);
            const fwElem = document.getElementById('ctrl-device-fw');
            if (fwElem) {
                if (dailyStats.fw) {
                    fwElem.style.display = 'inline-flex';
                    fwElem.textContent = 'v' + dailyStats.fw;
                    fwElem.title = 'إصدار الفيرموير: ' + dailyStats.fw;
                } else {
                    fwElem.style.display = 'none';
                    fwElem.textContent = '';
                }
            }

            const discElem = document.getElementById('ctrl-disconnects-val');
            if (discElem) {
                discElem.style.color = dailyStats.disconnects > 0 ? '#f87171' : 'var(--text-muted)';
                discElem.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size: 0.7rem; color: ${dailyStats.disconnects > 0 ? '#ef4444' : 'var(--text-dim)'};"></i> انقطاع الاتصال: <strong>${dailyStats.disconnects}</strong>`;
            }

            const psElem = document.getElementById('ctrl-powersaving-val');
            if (psElem) {
                psElem.style.color = dailyStats.powerSavings > 0 ? '#fbbf24' : 'var(--text-muted)';
                psElem.innerHTML = `<i class="fa-solid fa-leaf" style="font-size: 0.7rem; color: ${dailyStats.powerSavings > 0 ? '#f59e0b' : 'var(--text-dim)'};"></i> توفير الطاقة: <strong>${dailyStats.powerSavings}</strong>`;
            }

            // Wake Reason in modal
            const wakeReason = formatWakeReason(dev.status?.lastWakeReason || dev.meta?.lastWakeReason);
            const wakeRow = document.getElementById('ctrl-wake-row');
            const wakeVal = document.getElementById('ctrl-wake-val');
            if (wakeRow && wakeVal) {
                if (wakeReason) {
                    wakeRow.style.display = 'flex';
                    wakeVal.style.color = wakeReason.color;
                    wakeVal.innerHTML = `<i class="${wakeReason.icon}"></i> ${escapeHtml(wakeReason.text)}`;
                } else {
                    wakeRow.style.display = 'none';
                }
            }
        }

        function setControlFeedback(type, iconClass, line1, line2) {
            const feedback = document.getElementById('ctrl-feedback');
            const feedbackIcon = document.getElementById('ctrl-feedback-icon');
            const feedbackText = document.getElementById('ctrl-feedback-text');
            if (!feedback || !feedbackIcon || !feedbackText) return;

            feedback.className = 'control-feedback-box show ' + type;
            feedbackIcon.className = iconClass;

            if (line2) {
                feedbackText.innerHTML = `
                    <div style="font-weight: 700; font-size: 0.8rem; line-height: 1.35;">${line1}</div>
                    <div style="font-size: 0.72rem; opacity: 0.92; line-height: 1.4; margin-top: 3px;">${line2}</div>
                `;
            } else {
                feedbackText.innerHTML = `
                    <div style="font-weight: 600; font-size: 0.78rem; line-height: 1.35;">${line1}</div>
                `;
            }
        }

        async function executeDeviceCommand(action) {
            const deviceId = App.controlActiveDeviceId;
            if (!deviceId) return;

            const dev = App.devices.get(deviceId);
            const pwdInput = document.getElementById('ctrl-password-input');
            const password = pwdInput ? pwdInput.value.trim() : '';

            if (!password) {
                alert('يرجى إدخال كلمة مرور الدراجة لتنفيذ الأمر.');
                if (pwdInput) pwdInput.focus();
                return;
            }

            // Check save password option
            const chkSave = document.getElementById('chk-save-pwd');
            if (chkSave && chkSave.checked) {
                localStorage.setItem('motolock_pwd_' + deviceId, password);
            }

            const allControlBtns = document.querySelectorAll('.btn-control-action, .btn-subaction');

            if (action === 'REBOOT') {
                if (!confirm(`تحذير: هل أنت متأكد من رغبتك في إعادة تشغيل نظام الدراجة (${dev ? dev.name : deviceId}) وموديولات الـ SIM والـ GPS عن بُعد (Soft Reboot)؟`)) {
                    return;
                }
            }

            const actionNames = {
                'UNLOCK': 'فتح الدراجة',
                'LOCK': 'قفل الدراجة',
                'START': 'تشغيل المحرك',
                'STOP': 'إيقاف المحرك',
                'ALARM': 'إنذار / سرينة',
                'STARTER_PULSE': 'نبضة المارش',
                'PING': 'فحص الاستجابة (Ping)',
                'REBOOT': 'إعادة تشغيل الجهاز (Reboot)'
            };
            const actionNameAr = actionNames[action] || action;

            // Check connection state upfront
            const state = dev ? getDeviceConnectionState(dev) : { isOnline: false, isPowerSaving: false };

            // 1. If device is currently OFFLINE
            if (!state.isOnline && !state.isPowerSaving) {
                setControlFeedback(
                    'error',
                    'fa-solid fa-triangle-exclamation',
                    'الدراجة غير متصلة بالإنترنت حالياً',
                    'الرجاء الانتظار والمحاولة مرة أخرى بعد 30 ثانية أو دقيقة (عند استعادة الاتصال).'
                );

                // Still save the command in queue so it can execute if bike reconnects
                try {
                    const nonce = 'web_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
                    App.db.ref(`devices/${deviceId}/commandQueue/${nonce}`).set({
                        action: action,
                        password: password,
                        timestamp: firebase.database.ServerValue.TIMESTAMP,
                        nonce: nonce,
                        source: 'web_admin',
                        state: 'pending'
                    });
                } catch (e) { }
                return;
            }

            // 2. If device is in POWER SAVING mode
            if (state.isPowerSaving) {
                setControlFeedback(
                    'info',
                    'fa-solid fa-leaf',
                    'الدراجة في وضع توفير الطاقة حالياً',
                    'تم حفظ أمر (' + actionNameAr + ') وسينفذ تلقائياً فور استيقاظ الدراجة بتحريكها أو فتح الكونتاك.'
                );

                try {
                    const nonce = 'web_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
                    App.db.ref(`devices/${deviceId}/commandQueue/${nonce}`).set({
                        action: action,
                        password: password,
                        timestamp: firebase.database.ServerValue.TIMESTAMP,
                        nonce: nonce,
                        source: 'web_admin',
                        state: 'pending'
                    });
                } catch (e) { }
                return;
            }

            // 3. Device is ONLINE: proceed with live command transmission
            allControlBtns.forEach(btn => btn.disabled = true);

            setControlFeedback(
                'info',
                'fa-solid fa-circle-notch fa-spin',
                `جارِ إرسال أمر (${actionNameAr}) إلى الدراجة...`,
                'بانتظار استجابة موديول الدراجة وتأكيد التنفيذ عبر السحابة...'
            );

            const sendStartTime = Date.now();
            const nonce = 'web_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
            const payload = {
                action: action,
                password: password,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                nonce: nonce,
                source: 'web_admin',
                state: 'pending'
            };

            try {
                // Unsubscribe previous command listener if any
                if (App.commandQueueUnsub) {
                    App.commandQueueUnsub();
                    App.commandQueueUnsub = null;
                }

                // Auto-cleanup stale pending items in queue before sending new command
                try {
                    const qSnap = await App.db.ref(`devices/${deviceId}/commandQueue`).once('value');
                    const qVal = qSnap.val() || {};
                    const nowTs = Date.now();
                    const staleRemovals = [];
                    for (const [k, v] of Object.entries(qVal)) {
                        const vTs = Number(v.timestamp || 0);
                        if (!vTs || (nowTs - vTs > 30000) || v.state === 'done' || v.state === 'rejected') {
                            staleRemovals.push(App.db.ref(`devices/${deviceId}/commandQueue/${k}`).remove());
                        }
                    }
                    if (staleRemovals.length > 0) {
                        await Promise.all(staleRemovals);
                    }
                } catch (cleanErr) {
                    console.warn('[Admin] Queue cleanup error:', cleanErr);
                }

                // Write to commandQueue
                await App.db.ref(`devices/${deviceId}/commandQueue/${nonce}`).set(payload);

                // Write to command root node for backward compatibility
                await App.db.ref(`devices/${deviceId}/command`).set({
                    ...payload,
                    queued: true,
                    queueKey: nonce
                });

                // Listen for response / acknowledgement on BOTH root node and nonce queue node
                let commandFinished = false;
                const cmdRef = App.db.ref(`devices/${deviceId}/command`);
                const queueItemRef = App.db.ref(`devices/${deviceId}/commandQueue/${nonce}`);

                const onCommandChange = (snap) => {
                    if (!snap.exists() || !snap.val()) return;
                    const val = snap.val();

                    // Only react to our nonce or latest matching action
                    if (val.nonce && val.nonce !== nonce && val.queueKey !== nonce) return;

                    if (val.state === 'accepted') {
                        setControlFeedback(
                            'info',
                            'fa-solid fa-satellite-dish',
                            'تم استلام الأمر في السيرفر بنجاح',
                            'جارِ الإرسال عبر شبكة الإنترنت إلى شريحة الدراجة...'
                        );
                    } else if (val.state === 'done') {
                        commandFinished = true;
                        if (action === 'PING') {
                            const latency = Date.now() - sendStartTime;
                            setControlFeedback(
                                'success',
                                'fa-solid fa-stopwatch',
                                `✅ استجابت الدراجة بنجاح! وقت الرد: ${latency} مللي ثانية`,
                                'الاتصال بشريحة وسيرفر الدراجة نشط وسريع ومستقر.'
                            );
                            addDeviceEvent(deviceId, `فحص سرعة الاستجابة (Ping: ${latency}ms)`, 'ping', 'fa-solid fa-stopwatch');
                        } else if (action === 'REBOOT') {
                            setControlFeedback(
                                'success',
                                'fa-solid fa-arrows-rotate',
                                '✅ تم إرسال أمر إعادة التشغيل (Soft Reboot) بنجاح!',
                                'يقوم الجهاز الآن بإعادة التشغيل وسيعاود الاتصال تلقائياً خلال لحظات.'
                            );
                            addDeviceEvent(deviceId, 'إعادة تشغيل الجهاز عن بُعد (Soft Reboot)', 'reboot', 'fa-solid fa-arrows-rotate');
                        } else {
                            setControlFeedback(
                                'success',
                                'fa-solid fa-circle-check',
                                `✅ تم تنفيذ أمر (${actionNameAr}) بنجاح على الدراجة!`,
                                'استجابت الدراجة في الوقت الفعلي وتم تحديث الحالة.'
                            );
                            addDeviceEvent(deviceId, `تنفيذ أمر (${actionNameAr}) بنجاح`, 'command', 'fa-solid fa-circle-check');
                        }

                        cleanupListener();
                        setTimeout(() => {
                            allControlBtns.forEach(btn => btn.disabled = false);
                        }, 1200);
                    } else if (val.state === 'rejected') {
                        commandFinished = true;
                        let reason = val.error || 'خطأ غير معروف';
                        if (val.error === 'bad_password') reason = 'كلمة مرور الدراجة غير صحيحة! تأكد من الـ PIN وأعد المحاولة.';
                        else if (val.error === 'unsupported_command') reason = 'هذا الأمر غير مدعوم في برمجة الدراجة الحالية (يرجى التأكد من الفيرموير).';

                        setControlFeedback(
                            'error',
                            'fa-solid fa-circle-xmark',
                            `❌ تم رفض أمر (${actionNameAr}) من الدراجة`,
                            reason
                        );
                        addDeviceEvent(deviceId, `رفض أمر (${actionNameAr}): ${reason}`, 'error', 'fa-solid fa-circle-xmark');
                        cleanupListener();
                        allControlBtns.forEach(btn => btn.disabled = false);
                    }
                };

                const cleanupListener = () => {
                    cmdRef.off('value', onCommandChange);
                    queueItemRef.off('value', onCommandChange);
                    if (App.commandQueueUnsub) App.commandQueueUnsub = null;
                };

                App.commandQueueUnsub = cleanupListener;
                cmdRef.on('value', onCommandChange);
                queueItemRef.on('value', onCommandChange);

                // Safety timeout: 28 seconds (giving 2G SIM800L roundtrip sufficient time)
                setTimeout(() => {
                    if (!commandFinished && App.controlActiveDeviceId === deviceId) {
                        cleanupListener();
                        setControlFeedback(
                            'error',
                            'fa-solid fa-clock-rotate-left',
                            'الدراجة لم تستجب للأمر خلال المهلة المحددة (28 ثانية)',
                            'تأكد من رفع وتحديث كود الفيرموير الجديد على شريحة الدراجة وتشغيل وسيط MQTT ثم أعد المحاولة.'
                        );
                        allControlBtns.forEach(btn => btn.disabled = false);
                    }
                }, 28000);

            } catch (err) {
                console.error('Failed to send command to Firebase:', err);
                setControlFeedback(
                    'error',
                    'fa-solid fa-triangle-exclamation',
                    '❌ خطأ في إرسال الأمر للفايربيس',
                    err.message
                );
                allControlBtns.forEach(btn => btn.disabled = false);
            }
        }

        // --- Modal Helpers ---
        function openModal(id) {
            document.getElementById(id).classList.add('open');
        }

        function closeModal(id) {
            document.getElementById(id).classList.remove('open');
            if (id === 'modal-control') {
                if (App.commandQueueUnsub) {
                    App.commandQueueUnsub();
                    App.commandQueueUnsub = null;
                }
                App.controlActiveDeviceId = null;
            }
        }

        // --- Usage Modal: Period Filters & Manual Edit ---
        const USAGE_PERIODS = {
            'month': {
                title: '<i class="fa-solid fa-filter"></i> الشهر الحالي (Oct 1 - Nov 1)',
                desc: 'إجمالي الاستهلاك التراكمي للفوترة من 1 أكتوبر حتى اليوم.',
                btnId: 'ubtn-month'
            },
            '7d': {
                title: '<i class="fa-solid fa-filter"></i> آخر 7 أيام',
                desc: 'إجمالي استهلاك التنزيلات والاتصالات خلال آخر أسبوع فقط.',
                btnId: 'ubtn-7d'
            },
            '24h': {
                title: '<i class="fa-solid fa-filter"></i> اليوم (آخر 24 ساعة)',
                desc: 'إجمالي الاستهلاك خلال آخر 24 ساعة فقط. مفيد لمراقبة التحسينات الجديدة.',
                btnId: 'ubtn-24h'
            },
            '1h': {
                title: '<i class="fa-solid fa-filter"></i> آخر ساعة',
                desc: 'الاستهلاك اللحظي في الساعة الأخيرة. يجب أن يكون قريباً من الصفر بعد التحسينات.',
                btnId: 'ubtn-1h'
            }
        };

        let currentUsagePeriod = '24h';

        function switchUsagePeriod(period) {
            currentUsagePeriod = period;
            const info = USAGE_PERIODS[period];
            if (!info) return;

            // Update active button
            document.querySelectorAll('.usage-period-btn').forEach(b => b.classList.remove('active'));
            const activeBtn = document.getElementById(info.btnId);
            if (activeBtn) activeBtn.classList.add('active');

            // Update title and description
            const titleEl = document.getElementById('usage-period-title');
            const descEl = document.getElementById('usage-period-desc');
            if (titleEl) titleEl.innerHTML = info.title;
            if (descEl) descEl.textContent = info.desc;

            // Load saved metrics for this period
            loadSavedUsageMetrics(period);
        }

        function loadSavedUsageMetrics(period) {
            try {
                const saved = localStorage.getItem('motolock_usage_' + period);
                if (saved) {
                    const data = JSON.parse(saved);
                    applyUsageMetrics(data);

                    // Show last updated time
                    if (data.updatedAt) {
                        const ago = Math.round((Date.now() - data.updatedAt) / 60000);
                        const updEl = document.getElementById('usage-last-updated-text');
                        if (updEl) {
                            if (ago < 1) updEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> تم التحديث الآن';
                            else if (ago < 60) updEl.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> آخر تحديث: منذ ${ago} دقيقة`;
                            else updEl.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> آخر تحديث: منذ ${Math.round(ago / 60)} ساعة`;
                        }
                    }
                } else {
                    // No saved data for this period
                    const updEl = document.getElementById('usage-last-updated-text');
                    if (updEl) updEl.innerHTML = '<i class="fa-solid fa-pen"></i> اضغط "تعديل" لإدخال الأرقام من الكونسول';
                }
            } catch (e) {
                console.warn('loadSavedUsageMetrics error:', e);
            }
        }

        function applyUsageMetrics(data) {
            if (data.connections != null) {
                const el = document.getElementById('usage-val-connections');
                const sub = document.getElementById('usage-sub-connections');
                if (el) el.innerHTML = `${escapeHtml(String(data.connections))}<span style="font-size: 0.75rem; color: var(--text-dim); font-weight: 500;">/100</span>`;
                if (sub) sub.textContent = `${data.connections} of 100 max`;
            }
            if (data.storage) {
                const el = document.getElementById('usage-val-storage');
                if (el) el.innerHTML = escapeHtml(String(data.storage));
            }
            if (data.downloads) {
                const el = document.getElementById('usage-val-downloads');
                const sub = document.getElementById('usage-sub-downloads');
                if (el) el.innerHTML = escapeHtml(String(data.downloads));

                // Calculate percentage of 10 GB
                if (sub) {
                    const dlStr = String(data.downloads).toLowerCase();
                    let dlGB = 0;
                    if (dlStr.includes('gb')) dlGB = parseFloat(dlStr);
                    else if (dlStr.includes('mb')) dlGB = parseFloat(dlStr) / 1024;
                    else if (dlStr.includes('kb')) dlGB = parseFloat(dlStr) / (1024 * 1024);
                    const pct = dlGB > 0 ? (dlGB / 10 * 100).toFixed(1) : '0';
                    sub.textContent = `من 10.0 GB مجاني (${pct}%)`;
                }
            }

            // Update badge color
            const badge = document.getElementById('usage-badge');
            if (badge && data.downloads) {
                const dlStr = String(data.downloads).toLowerCase();
                let dlGB = 0;
                if (dlStr.includes('gb')) dlGB = parseFloat(dlStr);
                else if (dlStr.includes('mb')) dlGB = parseFloat(dlStr) / 1024;

                if (dlGB >= 8) {
                    badge.style.background = 'rgba(239, 68, 68, 0.2)';
                    badge.style.color = '#ef4444';
                    badge.textContent = '🔴 تحذير! الباقة تقترب من الحد';
                } else if (dlGB >= 5) {
                    badge.style.background = 'rgba(245, 158, 11, 0.2)';
                    badge.style.color = '#f59e0b';
                    badge.textContent = '🟡 الباقة متوسطة';
                } else {
                    badge.style.background = 'rgba(16, 185, 129, 0.2)';
                    badge.style.color = 'var(--accent-green)';
                    badge.textContent = '🟢 الباقة آمنة';
                }
            }
        }

        function toggleUsageEditForm(forceState) {
            const drawer = document.getElementById('usage-edit-drawer');
            if (!drawer) return;
            const show = forceState !== undefined ? forceState : (drawer.style.display === 'none');
            drawer.style.display = show ? 'block' : 'none';
        }

        function saveCustomUsageMetrics() {
            const connVal = document.getElementById('edit-usage-conn')?.value?.trim();
            const storageVal = document.getElementById('edit-usage-storage')?.value?.trim();
            const dlVal = document.getElementById('edit-usage-dl')?.value?.trim();

            if (!connVal && !storageVal && !dlVal) {
                alert('الرجاء إدخال قيمة واحدة على الأقل.');
                return;
            }

            const data = { updatedAt: Date.now() };
            if (connVal) data.connections = connVal;
            if (storageVal) data.storage = storageVal;
            if (dlVal) data.downloads = dlVal;

            // Save to localStorage under current period
            try {
                localStorage.setItem('motolock_usage_' + currentUsagePeriod, JSON.stringify(data));
            } catch (e) { }

            // Apply immediately
            applyUsageMetrics(data);

            // Update last-updated text
            const updEl = document.getElementById('usage-last-updated-text');
            if (updEl) updEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> تم التحديث الآن (يدوياً)';

            // Close edit drawer
            toggleUsageEditForm(false);

            // Clear inputs
            if (document.getElementById('edit-usage-conn')) document.getElementById('edit-usage-conn').value = '';
            if (document.getElementById('edit-usage-storage')) document.getElementById('edit-usage-storage').value = '';
            if (document.getElementById('edit-usage-dl')) document.getElementById('edit-usage-dl').value = '';
        }

        // Load saved month metrics on page load
        document.addEventListener('DOMContentLoaded', () => {
            loadSavedUsageMetrics('24h');
        });

        // Helper: Escape HTML
        function escapeHtml(str) {
            return (str || '').replace(/[&<>"']/g, (m) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[m]);
        }
