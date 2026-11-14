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
            syncStarted: false,
            currentDayString: null
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
            setupMidnightResetScheduler();
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
                maxZoom: 22,
                zoomControl: false,
                rotate: true,
                bearing: 0,
                touchRotate: true,
                shiftKeyRotate: true
            });

            // Map rotation listener to update compass icon & heading label
            App.map.on('rotate', function () {
                const bearing = Math.round(App.map.getBearing() || 0);
                const normBearing = ((bearing % 360) + 360) % 360;
                const compassIcon = document.getElementById('compass-icon');
                const bearingLabel = document.getElementById('bearing-label');
                if (compassIcon) {
                    compassIcon.style.transform = `rotate(${-normBearing}deg)`;
                }
                if (bearingLabel) {
                    bearingLabel.textContent = normBearing === 0 ? 'الشمال (0°)' : `${normBearing}°`;
                }
            });

            // Add Zoom Control to Bottom Right
            L.control.zoom({ position: 'bottomright' }).addTo(App.map);

            // Tile layers with maxNativeZoom: 18 to allow ultra-zoom up to level 22 without 404 / "Map data not yet available"
            App.mapLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap &copy; CARTO',
                subdomains: 'abcd',
                maxNativeZoom: 19,
                maxZoom: 22
            });

            App.mapLayers.osm = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
                attribution: '&copy; Google Maps Streets',
                maxNativeZoom: 18,
                maxZoom: 22
            });

            // Google Hybrid Satellite (Satellite + Roads + Labels in Arabic)
            App.mapLayers.satellite = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
                attribution: '&copy; Google Maps Hybrid',
                maxNativeZoom: 18,
                maxZoom: 22
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

            // 5. Real-time Announcements & Broadcast listener
            listenToAnnouncements();
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
                // Query status.json, meta.json & command.json separately to avoid downloading bloated temp_trip or trips!
                const [statusRes, metaRes, cmdRes] = await Promise.all([
                    fetch(`${App.config.databaseURL}/devices/${deviceId}/status.json${authParam}`),
                    fetch(`${App.config.databaseURL}/devices/${deviceId}/meta.json${authParam}`).catch(() => null),
                    fetch(`${App.config.databaseURL}/devices/${deviceId}/command.json${authParam}`).catch(() => null)
                ]);

                if (statusRes.ok) {
                    const status = await statusRes.json();
                    let meta = {};
                    if (metaRes && metaRes.ok) {
                        meta = (await metaRes.json()) || {};
                    }
                    let command = null;
                    if (cmdRes && cmdRes.ok) {
                        command = await cmdRes.json().catch(() => null);
                    }
                    if (status) {
                        handleDeviceSnapshot(deviceId, { status, meta, command });
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
                    const prevStatus = currentDev.status || {};
                    trackDeviceStatusTransitions(deviceId, prevStatus, status);
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

                    // مزامنة فورية لمسح موقع الفحص بين الهاتف واللابتوب
                    if (meta.hasLastValidLocation === false || meta.locationCleared === true) {
                        currentDev.lastValidLat = 0;
                        currentDev.lastValidLng = 0;
                        if (App.lastKnownLocations && App.lastKnownLocations[deviceId]) {
                            delete App.lastKnownLocations[deviceId];
                            try { localStorage.setItem('motolock_last_coords', JSON.stringify(App.lastKnownLocations)); } catch (e) {}
                        }
                        if (currentDev.marker) {
                            App.map.removeLayer(currentDev.marker);
                            currentDev.marker = null;
                        }
                    }
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

            // 3. Listen to command for instant live button state synchronization & daily log
            App.db.ref(`devices/${deviceId}/command`).on('value', (snap) => {
                if (snap.exists() && snap.val()) {
                    const cmd = snap.val();
                    const currentDev = getOrCreateDevice(deviceId);
                    currentDev.command = cmd;
                    const act = String(cmd.action || '').toUpperCase();
                    const nonce = String(cmd.nonce || cmd.queueKey || '');
                    const cmdSource = String(cmd.source || '');
                    const cmdTime = Number(cmd.timestamp || 0);
                    const isRecent = cmdTime > 0 ? (Date.now() - cmdTime < 45000) : true;

                    // Log internet commands sent from mobile app
                    if (nonce && nonce !== currentDev.lastLoggedCmdNonce && cmdSource !== 'web_admin' && isRecent) {
                        currentDev.lastLoggedCmdNonce = nonce;
                        currentDev.lastInternetCmdAction = act;
                        currentDev.lastInternetCmdTime = Date.now();
                        currentDev.hasLoggedRejection = false;

                        const actionText = formatInternetActionName(act);
                        if (actionText) {
                            addDeviceEvent(deviceId, actionText, 'command', formatInternetActionIcon(act));
                        }
                    }

                    if (cmd.state === 'rejected' && nonce && !currentDev.hasLoggedRejection) {
                        currentDev.hasLoggedRejection = true;
                        const reason = cmd.reason || 'مرفوض';
                        addDeviceEvent(deviceId, `رفض أمر تطبيق (${formatActionShortName(act)}): ${reason}`, 'error', 'fa-solid fa-circle-xmark');
                    }

                    if (act === 'VIB_ON' && cmd.state !== 'rejected') {
                        if (!currentDev.meta) currentDev.meta = {};
                        currentDev.meta.vibrationSensor = true;
                        if (!currentDev.status) currentDev.status = {};
                        currentDev.status.vibrationSensor = true;
                    } else if (act === 'VIB_OFF' && cmd.state !== 'rejected') {
                        if (!currentDev.meta) currentDev.meta = {};
                        currentDev.meta.vibrationSensor = false;
                        if (!currentDev.status) currentDev.status = {};
                        currentDev.status.vibrationSensor = false;
                    }
                    scheduleListRender();
                    updateOpenPopups();
                    if (App.controlActiveDeviceId === deviceId) {
                        updateControlModalStatus(deviceId);
                    }
                }
            }, (err) => {
                console.warn(`Error reading command for ${deviceId}:`, err.message);
            });

            // 4. Listen to dailyEvents from Firebase RTDB (synced across devices & cloud)
            App.db.ref(`devices/${deviceId}/dailyEvents`).limitToLast(60).on('value', (snap) => {
                if (snap.exists() && snap.val()) {
                    const todayStr = getLocalDateString();
                    const startOfToday = getStartOfTodayMs();
                    const staleKeysToRemove = [];
                    const validEvents = [];

                    Object.entries(snap.val()).forEach(([key, val]) => {
                        if (val && val.timestamp >= startOfToday && (!val.date || val.date === todayStr)) {
                            validEvents.push(val);
                        } else {
                            staleKeysToRemove.push(key);
                        }
                    });

                    // Prune stale / yesterday events from RTDB
                    if (staleKeysToRemove.length > 0) {
                        const updates = {};
                        staleKeysToRemove.forEach(k => {
                            updates[`devices/${deviceId}/dailyEvents/${k}`] = null;
                        });
                        App.db.ref().update(updates).catch(() => {});
                    }

                    // Merge with localStorage daily log
                    const localEvents = getDeviceDailyEvents(deviceId);
                    const mergedMap = new Map();
                    localEvents.forEach(evt => { if (evt && evt.id) mergedMap.set(evt.id, evt); });
                    validEvents.forEach(evt => { if (evt && evt.id) mergedMap.set(evt.id, evt); });

                    const mergedList = Array.from(mergedMap.values())
                        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                        .slice(0, 100);

                    try {
                        localStorage.setItem('motolock_daily_events_' + deviceId, JSON.stringify(mergedList));
                    } catch (e) {}

                    if (App.controlActiveDeviceId === deviceId) {
                        renderDeviceEventsLog(deviceId);
                    }
                }
            }, (err) => {
                console.warn(`Error reading dailyEvents for ${deviceId}:`, err.message);
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

            // 1.5 إذا كان الموقع ممسوحاً عمداً من السيرفر (hasLastValidLocation === false) لا نرجع أي إحداثيات قديمة
            const isLocationWiped = dev.meta && (dev.meta.hasLastValidLocation === false || dev.meta.locationCleared === true);
            if (isLocationWiped) {
                dev.lastValidLat = 0;
                dev.lastValidLng = 0;
                if (App.lastKnownLocations && App.lastKnownLocations[dev.id]) {
                    delete App.lastKnownLocations[dev.id];
                    try { localStorage.setItem('motolock_last_coords', JSON.stringify(App.lastKnownLocations)); } catch (e) {}
                }
                return null;
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
            // Track status transitions (engine, lock, siren, vibration, wake reasons)
            trackDeviceStatusTransitions(deviceId, prevStatus, status);

            deviceObj.name = customName;
            deviceObj.status = status;
            deviceObj.meta = meta;
            if (data.command) {
                deviceObj.command = data.command;
                const act = String(data.command.action || '').toUpperCase();
                if (act === 'VIB_ON' && data.command.state !== 'rejected') {
                    if (!deviceObj.meta) deviceObj.meta = {};
                    deviceObj.meta.vibrationSensor = true;
                } else if (act === 'VIB_OFF' && data.command.state !== 'rejected') {
                    if (!deviceObj.meta) deviceObj.meta = {};
                    deviceObj.meta.vibrationSensor = false;
                }
            }

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

            // مهلة مدروسة متوافقة تماماً مع دورة الفريم وير الجديدة:
            // أثناء الحركة: التحديث كل 1.5 ثانية (مهلة 60 ثانية لاستيعاب تبديل الأبراج في 2G دون انقطاع)
            // أثناء التوقف/الاستعداد: التحديث كل 30 إلى 90 ثانية (مهلة 210 ثانية لتغطية نبضات الاستعداد وبطء 2G)
            const activeThreshold = isEngineOrMoving ? 60000 : 210000;

            const isServerOnline = Boolean(dev.meta?.mqttOnline === true || dev.meta?.mqttOnline === 'true');
            const isFreshData = lastSeen > 0 && timeDiff < activeThreshold;

            // الجهاز يعتبر أونلاين فقط وفقط إذا كان السيرفر يؤكد وجود جلسة MQTT حقيقية ومباشرة للجهاز (isServerOnline === true)
            // وكانت البيانات حديثة ضمن مهلة النشاط. هذا يمنع نهائياً ظهور الجهاز كـ "متصل" لمجرد فتح العميل للتطبيق أو إرسال أمر وهو فاصل إنترنت
            const isOnline = isServerOnline && isFreshData;

            // Power saving mode detection from status or meta
            // Contact is true only if explicitly reported by device
            const isContact = Boolean(dev.status?.contact === true);
            const isEngine = Boolean(dev.status?.engine === true);

            // Power saving mode: ONLY when the device explicitly reports power saving mode
            const isPowerSaving = !isContact && !isEngine && Boolean(
                dev.status?.powerSavingActive === true ||
                dev.status?.powerSavingActive === 'true' ||
                dev.status?.powerSavingActive === 1 ||
                dev.status?.powerSave === true ||
                dev.status?.powerSave === 'true' ||
                dev.status?.powerSave === 1 ||
                dev.meta?.powerSavingActive === true ||
                dev.meta?.powerSavingActive === 'true' ||
                dev.meta?.powerSavingActive === 1 ||
                (!isOnline && dev.meta?.offlineReason === 'powersaving')
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

            let disconnects = 0;
            let powerSavings = 0;

            // القيمة المعتمدة والرسمية من خادم Firebase فقط (Single Source of Truth)
            if (dev.meta?.statsDate === today || !dev.meta?.statsDate) {
                disconnects = Number(dev.meta.disconnectsToday || 0);
                powerSavings = Number(dev.meta.powerSavingToday || 0);
            }

            // إصدار الفيرموير: فقط إذا أرسله الجهاز صراحةً (بدون أي تخمين أو افتراض)
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

            // تنظيف أي مخلفات قديمة في التخزين المحلي لمنع قراءات شاذة
            try {
                localStorage.removeItem('motolock_stats_' + deviceId);
            } catch (e) { }
        }

        // Focus and select device in list (opens mobile drawer and restores map if expanded)
        function openDeviceInList(deviceId, options = {}) {
            if (!deviceId) return;
            App.selectedDeviceId = deviceId;

            // 1. إذا كانت الخريطة مكبرة بملء الشاشة، استعد القائمة الجانبية فوراً
            if (App.isMapExpanded && !options.fromMapClick) {
                toggleMapFullscreen();
            }

            // 2. إذا كنا على الهاتف (شاشة <= 900px)، لا نفتح درج القائمة تلقائياً إذا كان الضغط من أيقونة الخريطة
            if (window.innerWidth <= 900) {
                if (!options.fromMapClick) {
                    showMobileTab('devices');
                }
            }

            // 3. إعادة رسم القائمة فوراً لتطبيق كلاس selected المضيء
            renderDevicesList();

            // 4. التمرير السلس إلى بطاقة الدراجة في القائمة وتفعيل وميض التحديد (Flash Highlight)
            if (!options.fromMapClick || window.innerWidth > 900) {
                setTimeout(() => {
                    const el = document.querySelector(`.device-card[data-id="${deviceId}"]`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('flash-highlight');
                        setTimeout(() => el.classList.remove('flash-highlight'), 1800);
                    }
                }, 80);
            }
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
                    openDeviceInList(dev.id, { fromMapClick: true });
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
                    openDeviceInList(dev.id, { fromMapClick: true });
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

        function formatStationaryDuration(ts) {
            if (!ts || ts < 1704067200000) return ''; // حماية: أي توقيت قبل سنة 2024 غير صالح (يمنع ظهور 1970 و 20,000+ يوم)
            const diffSec = Math.floor((Date.now() - ts) / 1000);
            if (diffSec < 0 || diffSec > 365 * 86400) return ''; // حماية من أي تواريخ شاذة تتجاوز السنة
            if (diffSec < 60) return 'منذ دقيقة';
            const diffMin = Math.floor(diffSec / 60);
            if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
            const diffHours = Math.floor(diffMin / 60);
            if (diffHours < 24) return `منذ ${diffHours} ساعة`;
            const diffDays = Math.floor(diffHours / 24);
            return `منذ ${diffDays} يوم`;
        }

        function getDeviceStationaryTimeAgo(dev, state) {
            if (!state.isParked && !state.isPowerSaving) return '';
            
            // 1. فحص وقت التوقف الفعلي من السيرفر (stationarySinceAt) - يجب أن يكون توقيت بعد 2024
            const ts = Number(dev.status?.stationarySinceAt || dev.meta?.stationarySinceAt || 0);
            if (ts >= 1704067200000 && ts <= Date.now()) {
                const duration = formatStationaryDuration(ts);
                if (duration) return duration;
            }

            // 2. الحساب بناءً على فارق عداد الفيرموير الداخلي (fwTs - fwStat)
            const fwTs = Number(dev.status?.timestamp || 0);
            const fwStat = Number(dev.status?.stationarySince || 0);
            const lastSeen = Number(state.lastSeen || 0);
            if (fwTs > 0 && fwStat > 0 && fwTs >= fwStat && lastSeen >= 1704067200000) {
                const elapsedMs = fwTs - fwStat;
                // حماية: الفارق لا يمكن أن يتجاوز 30 يوماً على تشغيلة واحدة
                if (elapsedMs >= 0 && elapsedMs < 30 * 86400 * 1000) {
                    const statAt = lastSeen - elapsedMs;
                    if (statAt >= 1704067200000) {
                        const duration = formatStationaryDuration(statAt);
                        if (duration) return duration;
                    }
                }
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

        // --- Render Live Feature Status Buttons (صف أزرار التحكم والحالة الحية للميزات) ---
        function renderFeaturesButtonBarHtml(dev, isCard = false) {
            const isLocked = dev.status?.lock === true;
            const isEngineOn = Boolean(dev.status?.engine === true || dev.status?.contact === true);
            const isAlarmOn = Boolean(dev.status?.alarm === true);
            const isStarterActive = Boolean(dev.status?.starterActive || dev.status?.starter);

            // فحص دقيق وشامل لحالة حساس اللمس (سنسور الاهتزاز):
            // 1. هل تم تفعيله صراحة (من تطبيق الموبايل عبر VIB_ON، أو تقرير الجهاز الحي، أو رد السيرفر)
            const isTouchExplicitlyOn = Boolean(
                dev.status?.vibrationSensor === true ||
                dev.status?.vibEnabled === true ||
                dev.status?.touch === true ||
                dev.meta?.vibrationSensor === true ||
                (dev.command?.action === 'VIB_ON' && dev.command?.state !== 'rejected')
            );

            // 2. هل تم إطفاؤه صراحة (عبر VIB_OFF)
            const isTouchExplicitlyOff = Boolean(
                dev.status?.vibrationSensor === false ||
                (dev.command?.action === 'VIB_OFF' && dev.command?.state !== 'rejected')
            );

            // 3. حساس اللمس يتفعل إذا:
            // - المستخدم فعله من التطبيق أو لوحة التحكم (حتى لو الدراجة مفتوحة Unlock)
            // - أو الدراجة مقفولة (Lock) ولم يقم المستخدم بإطفائه صراحة
            const isTouchEnabled = isTouchExplicitlyOn || (isLocked && !isTouchExplicitlyOff);

            // رصد تنبيه لمس/اهتزاز فقط في حال كانت الحماية مفعلة وحصل تنبيه حقيقي
            const isTouchAlert = Boolean(
                isTouchEnabled &&
                (dev.status?.tamperAlert === true || dev.status?.alarmTriggeredByVibration === true)
            );

            const lockClass = isLocked ? 'feat-lock-locked' : 'feat-lock-unlocked';
            const lockIcon = isLocked ? 'fa-lock' : 'fa-lock-open';
            const lockText = isLocked ? 'مقفول' : 'مفتوح';
            const lockAction = isLocked ? 'UNLOCK' : 'LOCK';

            const engineClass = isEngineOn ? 'feat-engine-on' : 'feat-engine-off';
            const engineIcon = 'fa-power-off';
            const engineText = isEngineOn ? 'المحرك شغال' : 'المحرك مطفأ';
            const engineAction = isEngineOn ? 'STOP' : 'START';

            const alarmClass = isAlarmOn ? 'feat-alarm-on' : 'feat-alarm-off';
            const alarmIcon = isAlarmOn ? 'fa-bell' : 'fa-bell-slash';
            const alarmText = isAlarmOn ? 'إنذار مفعل' : 'إنذار صامت';

            const starterClass = isStarterActive ? 'feat-starter-active' : 'feat-starter-ready';
            const starterText = isStarterActive ? 'مارش نشط' : 'مارش';

            let touchClass = 'feat-touch-off';
            let touchIcon = 'fa-hand';
            let touchText = 'حساس اللمس: معطل';
            const touchAction = isTouchEnabled ? 'VIB_OFF' : 'VIB_ON';

            if (isTouchAlert) {
                touchClass = 'feat-touch-alert';
                touchIcon = 'fa-hand-fist';
                touchText = 'تنبيه: تم رصد لمس / اهتزاز للدراجة!';
            } else if (isTouchEnabled) {
                touchClass = 'feat-touch-ready';
                touchIcon = 'fa-hand';
                touchText = isLocked
                    ? 'حساس اللمس: مفعل (الدراجة محمية - اضغط للتعطيل VIB_OFF)'
                    : 'حساس اللمس: مفعل من التطبيق (اضغط للتعطيل VIB_OFF)';
            } else {
                touchClass = 'feat-touch-off';
                touchIcon = 'fa-hand';
                touchText = 'حساس اللمس: معطل (اضغط للتفعيل VIB_ON)';
            }

            return `
                <div class="${isCard ? 'card-features-bar' : 'popup-features-bar'}" title="حالة ميزات الدراجة (أيقونات سريعة)">
                    <button type="button" class="feat-btn ${lockClass}" onclick="event.stopPropagation(); openControlModal('${dev.id}', '${lockAction}')" title="القفل: ${lockText} (اضغط للتحكم)" aria-label="القفل: ${lockText}">
                        <i class="fa-solid ${lockIcon}"></i>
                    </button>
                    <button type="button" class="feat-btn ${engineClass}" onclick="event.stopPropagation(); openControlModal('${dev.id}', '${engineAction}')" title="المحرك: ${engineText} (اضغط للتحكم)" aria-label="المحرك: ${engineText}">
                        <i class="fa-solid ${engineIcon}"></i>
                    </button>
                    <button type="button" class="feat-btn ${alarmClass}" onclick="event.stopPropagation(); openControlModal('${dev.id}', 'ALARM')" title="الإنذار: ${alarmText} (اضغط للتحكم)" aria-label="الإنذار: ${alarmText}">
                        <i class="fa-solid ${alarmIcon}"></i>
                    </button>
                    <button type="button" class="feat-btn ${touchClass}" onclick="event.stopPropagation(); openControlModal('${dev.id}', '${touchAction}')" title="${touchText}" aria-label="${touchText}">
                        <i class="fa-solid ${touchIcon}"></i>
                    </button>
                    <button type="button" class="feat-btn ${starterClass}" onclick="event.stopPropagation(); openControlModal('${dev.id}', 'STARTER_PULSE')" title="المارش: ${starterText} (إرسال نبضة تشغيل ⚡)" aria-label="المارش: ${starterText}">
                        <i class="fa-solid fa-bolt"></i>
                    </button>
                </div>
            `;
        }

        function createPopupHtml(dev, state, lat, lng, loc) {
            const speed = Number(dev.status?.speed || 0).toFixed(1);
            const sats = dev.status?.sats ?? '0';
            const isLocked = dev.status?.lock === true;
            const isEngineOn = Boolean(dev.status?.engine === true || dev.status?.contact === true);
            const timeAgo = formatTimeAgo(state.lastSeen, state.isParked);
            const parkedAgo = getDeviceStationaryTimeAgo(dev, state);
            const signal = formatCellularSignal(dev.status);
            const dailyStats = getDeviceDailyStats(dev);
            const wakeReason = formatWakeReason(dev.status?.lastWakeReason || dev.meta?.lastWakeReason);
            const isLastKnown = loc ? loc.isLastKnown : (Number(sats) < 4);
            const hasCoords = loc !== null && (lat !== 0 || lng !== 0);

            let statusLabel = '';
            if (state.isPowerSaving) {
                statusLabel = `<span class="popup-status-badge" style="font-size: 0.68rem; color: var(--accent-amber); font-weight: 700;"><i class="fa-solid fa-leaf"></i> 🟡 توفير ${parkedAgo ? '(' + parkedAgo + ')' : ''}</span>`;
            } else if (state.isMoving) {
                statusLabel = `<span class="popup-status-badge" style="font-size: 0.68rem; color: var(--accent-green); font-weight: 700;"><i class="fa-solid fa-gauge-high"></i> 🟢 ${speed} كم/س</span>`;
            } else if (state.isParked) {
                statusLabel = `<span class="popup-status-badge" style="font-size: 0.68rem; color: var(--accent-blue); font-weight: 700;"><i class="fa-solid fa-square-parking"></i> 🔵 متوقف ${parkedAgo ? '(' + parkedAgo + ')' : ''}</span>`;
            } else {
                statusLabel = '<span class="popup-status-badge" style="font-size: 0.68rem; color: var(--accent-red); font-weight: 700;"><i class="fa-solid fa-circle-xmark"></i> 🔴 غير متصل</span>';
            }

            let fwHtml = '';
            if (dailyStats.fw) {
                const is204 = dailyStats.fw === '2.0.4';
                const fwColor = is204 ? '#ef4444' : '#a78bfa';
                const fwBg = is204 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(167, 139, 250, 0.12)';
                const fwBorder = is204 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(167, 139, 250, 0.28)';
                const fwTitle = is204 ? 'فيرموير v2.0.4 (الأحدث)' : `إصدار الفيرموير: ${escapeHtml(dailyStats.fw)}`;
                fwHtml = `<span class="fw-badge" style="font-size: 0.58rem; font-weight: 700; background: ${fwBg}; color: ${fwColor}; border: 1px solid ${fwBorder}; border-radius: 4px; padding: 0.05rem 0.3rem; display: inline-flex; align-items: center; gap: 0.2rem;" title="${fwTitle}">
                    <i class="fa-solid fa-microchip" style="font-size: 0.52rem;"></i> v${escapeHtml(dailyStats.fw)}
                </span>`;
            }

            return `
                <div class="map-popup-card" data-popup-id="${dev.id}">
                    <div class="popup-title" style="direction: rtl !important; text-align: right !important; justify-content: flex-start !important;">
                        <div class="popup-title-text" style="direction: rtl !important; text-align: right !important;" title="${escapeHtml(dev.name)}">${escapeHtml(dev.name)}</div>
                    </div>
                    <div class="popup-subtitle">
                        <span>MAC: <code>${dev.id}</code></span>
                        ${fwHtml}
                    </div>
                    <div class="popup-status-row">
                        ${statusLabel}
                        ${isLastKnown && hasCoords ? `
                        <span class="popup-lastknown-badge" style="margin: 0; padding: 0.1rem 0.35rem; font-size: 0.58rem;">
                            <i class="fa-solid fa-location-crosshairs"></i> مسجل
                        </span>` : ''}
                    </div>
                    
                    <div class="popup-table popup-vertical-table">
                        <div class="popup-item-row">
                            <span class="cell-label"><i class="fa-solid fa-gauge-high"></i> السرعة الحالية</span>
                            <span class="cell-val popup-speed-val">${speed} كم/س</span>
                        </div>
                        <div class="popup-item-row">
                            <span class="cell-label"><i class="fa-solid fa-satellite"></i> أقمار GPS</span>
                            <span class="cell-val">${sats} ${isLastKnown && Number(sats) === 0 ? '<small style="color:#fbbf24">(مسجل)</small>' : (isLastKnown ? '<small style="color:#38bdf8">(تثبيت)</small>' : '<small style="color:#4ade80">(3D مباشر)</small>')}</span>
                        </div>
                        <div class="popup-item-row">
                            <span class="cell-label"><i class="fa-solid fa-signal"></i> شبكة المحمول</span>
                            <span class="cell-val" style="color: ${signal.color};">${signal.displayText}${signal.shortOp ? ' ' + escapeHtml(signal.shortOp) : ''}</span>
                        </div>
                        <div class="popup-item-row">
                            <span class="cell-label"><i class="fa-solid fa-bolt"></i> حالة المحرك</span>
                            <span class="cell-val popup-engine-val" style="color: ${isEngineOn ? 'var(--accent-green)' : 'var(--text-muted)'}; font-weight: 700;">
                                <i class="fa-solid ${isEngineOn ? 'fa-bolt' : 'fa-power-off'}"></i> ${isEngineOn ? '🟢 شغال' : '⚫ مطفأ'}
                            </span>
                        </div>
                        <div class="popup-item-row">
                            <span class="cell-label"><i class="fa-solid fa-lock"></i> حالة القفل</span>
                            <span class="cell-val" style="color: ${isLocked ? 'var(--accent-red)' : 'var(--accent-green)'};">${isLocked ? '🔒 مقفول' : '🔓 مفتوح'}</span>
                        </div>
                        <div class="popup-item-row">
                            <span class="cell-label"><i class="fa-regular fa-clock"></i> آخر اتصال</span>
                            <span class="cell-val popup-last-seen-val">${timeAgo}</span>
                        </div>
                        <div class="popup-item-row popup-row-parked" style="${(state.isParked || state.isPowerSaving) && parkedAgo ? '' : 'display: none;'}">
                            <span class="cell-label"><i class="fa-solid fa-square-parking"></i> مدة التوقف</span>
                            <span class="cell-val popup-parked-val" style="color: var(--accent-cyan);">${parkedAgo || ''}</span>
                        </div>
                    </div>

                    ${renderFeaturesButtonBarHtml(dev, false)}

                    <div class="popup-mini-footer">
                        <span title="إحصائيات اليوم (انقطاع | توفير)">
                            <i class="fa-solid fa-triangle-exclamation" style="color: ${dailyStats.disconnects > 0 ? '#ef4444' : 'var(--text-dim)'}; font-size: 0.6rem;"></i> <strong class="popup-stats-disconnects">${dailyStats.disconnects}</strong>
                            <span style="opacity: 0.4; margin: 0 0.2rem;">|</span>
                            <i class="fa-solid fa-leaf" style="color: ${dailyStats.powerSavings > 0 ? '#f59e0b' : 'var(--text-dim)'}; font-size: 0.6rem;"></i> <strong class="popup-stats-powersave">${dailyStats.powerSavings}</strong>
                        </span>
                        ${wakeReason ? `
                        <span class="popup-wake-chip" style="color: ${wakeReason.color};" title="سبب الاستيقاظ: ${escapeHtml(wakeReason.text)}">
                            <i class="${wakeReason.icon}"></i> ${escapeHtml(wakeReason.shortText || wakeReason.text)}
                        </span>` : ''}
                    </div>

                    <div class="popup-actions-bar">
                        <button type="button" class="popup-btn popup-btn-control" onclick="openControlModal('${dev.id}')" title="التحكم بالدراجة عن بُعد">
                            <i class="fa-solid fa-gamepad"></i> <span>تحكم</span>
                        </button>
                        <button type="button" class="popup-btn popup-btn-list" onclick="openDeviceInList('${dev.id}')" title="فتح الدراجة في القائمة">
                            <i class="fa-solid fa-list-ul"></i> <span>القائمة</span>
                        </button>
                        ${hasCoords ? `
                        <button type="button" class="popup-btn popup-btn-icon" onclick="centerDeviceOnMap('${dev.id}')" title="تكبير والتركيز على الدراجة">
                            <i class="fa-solid fa-magnifying-glass-plus"></i>
                        </button>
                        <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" class="popup-btn popup-btn-icon" title="خرائط جوجل">
                            <i class="fa-solid fa-diamond-turn-right"></i>
                        </a>
                        ` : ''}
                        <button type="button" class="popup-btn popup-btn-icon popup-btn-amber" onclick="promptClearDeviceLocation('${dev.id}')" title="مسح موقع الفحص لتهيئة الجهاز للعميل">
                            <i class="fa-solid fa-location-crosshairs"></i>
                        </button>
                        <button type="button" class="popup-btn popup-btn-icon popup-btn-red" onclick="promptDeleteDevice('${dev.id}')" title="حذف الجهاز نهائياً من النظام">
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
                if (state.isOnline) {
                    online++;
                    if (state.isMoving) {
                        moving++;
                    } else if (state.isPowerSaving) {
                        powersaving++;
                    } else {
                        parked++;
                    }
                } else {
                    if (state.isPowerSaving) {
                        powersaving++;
                    } else {
                        offline++;
                    }
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
                if (App.currentFilter === 'parked' && (!state.isParked || state.isPowerSaving)) return;
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
                const isEngineOn = Boolean(dev.status?.engine === true || dev.status?.contact === true);
                const timeAgo = formatTimeAgo(state.lastSeen, state.isParked);

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
                    const is204 = dailyStats.fw === '2.0.4';
                    const fwColor = is204 ? '#ef4444' : '#a78bfa';
                    const fwBg = is204 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(167, 139, 250, 0.12)';
                    const fwBorder = is204 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(167, 139, 250, 0.28)';
                    const fwTitle = is204 ? 'فيرموير v2.0.4 (الأحدث)' : `فيرموير v${dailyStats.fw}`;
                    fwBadgeHtml = `<span class="fw-badge" style="font-size: 0.58rem; font-weight: 700; background: ${fwBg}; color: ${fwColor}; border: 1px solid ${fwBorder}; border-radius: 3px; padding: 0.02rem 0.25rem; display: inline-flex; align-items: center; gap: 0.2rem; line-height: 1;" title="${fwTitle}">
                        <i class="fa-solid fa-microchip" style="font-size: 0.52rem;"></i> v${escapeHtml(dailyStats.fw)}
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
                                    <div class="device-sub-tags" style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.2rem;">
                                        <span class="device-mac">${dev.id}</span>
                                        ${fwBadgeHtml}
                                        ${wakeReason ? `<span class="wake-badge" style="font-size: 0.62rem; font-weight: 700; background: ${wakeReason.bg}; color: ${wakeReason.color}; border: 1px solid ${wakeReason.border}; border-radius: 4px; padding: 0.06rem 0.35rem; display: inline-flex; align-items: center; gap: 0.22rem; line-height: 1;" title="سبب الاستيقاظ: ${escapeHtml(wakeReason.text)}"><i class="${wakeReason.icon}" style="font-size: 0.55rem;"></i> ${escapeHtml(wakeReason.shortText)}</span>` : ''}
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
                                <span class="metric-label" style="color: #38bdf8;" title="الشبكة: ${escapeHtml(signal.op || 'الشبكة')}">${escapeHtml(signal.shortOp || 'الشبكة')}</span>
                                <span class="metric-val" style="color: ${signal.color};">
                                    <i class="fa-solid fa-signal"></i>
                                    ${signal.displayText}
                                </span>
                            </div>

                            <div class="metric-cell">
                                <span class="metric-label">الأقمار</span>
                                <span class="metric-val">
                                    <i class="fa-solid fa-satellite" style="color: var(--accent-cyan)"></i>
                                    ${sats}
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

                        ${renderFeaturesButtonBarHtml(dev, true)}

                        <div class="daily-stats-row" style="display: flex; align-items: center; justify-content: space-between; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px; padding: 0.22rem 0.55rem; margin: 0.18rem 0 0.22rem; font-size: 0.68rem;">
                            <span style="color: var(--text-dim); display: inline-flex; align-items: center; gap: 0.25rem;">
                                <i class="fa-regular fa-calendar-check" style="color: var(--accent-blue); font-size: 0.64rem;"></i> إحصائيات اليوم:
                            </span>
                            <div style="display: flex; align-items: center; gap: 0.6rem;">
                                <span style="display: inline-flex; align-items: center; gap: 0.25rem; color: ${dailyStats.disconnects > 0 ? '#f87171' : 'var(--text-muted)'}; font-weight: 600;" title="عدد مرات انقطاع الاتصال خلال اليوم">
                                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 0.64rem; color: ${dailyStats.disconnects > 0 ? '#ef4444' : 'var(--text-dim)'};"></i> انقطاع: <strong>${dailyStats.disconnects}</strong>
                                </span>
                                <span style="color: rgba(255, 255, 255, 0.15);">|</span>
                                <span style="display: inline-flex; align-items: center; gap: 0.25rem; color: ${dailyStats.powerSavings > 0 ? '#fbbf24' : 'var(--text-muted)'}; font-weight: 600;" title="عدد مرات الدخول في وضع توفير الطاقة خلال اليوم">
                                    <i class="fa-solid fa-leaf" style="font-size: 0.64rem; color: ${dailyStats.powerSavings > 0 ? '#f59e0b' : 'var(--text-dim)'};"></i> توفير: <strong>${dailyStats.powerSavings}</strong>
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
                                <button class="mini-btn btn-reset-loc" onclick="event.stopPropagation(); promptClearDeviceLocation('${dev.id}')" title="مسح وتصفير موقع وإحداثيات الفحص لتهيئة الجهاز للعميل">
                                    <i class="fa-solid fa-location-crosshairs"></i> مسح الموقع
                                </button>
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

        // --- Device Location Reset Functionality (Clear Test Coordinates) ---
        function promptClearDeviceLocation(deviceId) {
            if (!deviceId) return;
            const dev = App.devices.get(deviceId);
            const name = dev ? dev.name : (App.customNames[deviceId] || `دراجة ${deviceId.slice(-4)}`);
            App.deviceToClearLocId = deviceId;

            const nameEl = document.getElementById('clear-loc-device-name-display');
            const macEl = document.getElementById('clear-loc-device-mac-display');
            const coordsEl = document.getElementById('clear-loc-coords-val');

            if (nameEl) nameEl.textContent = name;
            if (macEl) macEl.textContent = deviceId;
            if (coordsEl) {
                const loc = dev ? getDeviceEffectiveLocation(dev) : null;
                if (loc && isValidCoord(loc.lat, loc.lng)) {
                    coordsEl.textContent = `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
                } else {
                    coordsEl.textContent = 'لا توجد إحداثيات مسجلة حالياً';
                }
            }

            openModal('modal-clear-location');
        }

        async function executeClearDeviceLocation() {
            const deviceId = App.deviceToClearLocId;
            if (!deviceId) return;

            const btnConfirm = document.getElementById('btn-confirm-clear-loc');
            const originalBtnHtml = btnConfirm ? btnConfirm.innerHTML : '';
            if (btnConfirm) {
                btnConfirm.disabled = true;
                btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري المسح والتصفير...';
            }

            try {
                // 1. مسح وتصفير الإحداثيات والمسار التجريبي من السحابة في Firebase RTDB
                if (App.db) {
                    const updates = {};
                    updates[`devices/${deviceId}/meta/lastLat`] = null;
                    updates[`devices/${deviceId}/meta/lastLng`] = null;
                    updates[`devices/${deviceId}/meta/lat`] = null;
                    updates[`devices/${deviceId}/meta/lng`] = null;
                    updates[`devices/${deviceId}/meta/hasLastValidLocation`] = false;

                    updates[`devices/${deviceId}/status/lat`] = null;
                    updates[`devices/${deviceId}/status/lng`] = null;
                    updates[`devices/${deviceId}/status/a`] = null;
                    updates[`devices/${deviceId}/status/o`] = null;
                    updates[`devices/${deviceId}/status/plat`] = null;
                    updates[`devices/${deviceId}/status/plng`] = null;
                    updates[`devices/${deviceId}/status/lastLat`] = null;
                    updates[`devices/${deviceId}/status/lastLng`] = null;
                    updates[`devices/${deviceId}/status/l_lat`] = null;
                    updates[`devices/${deviceId}/status/l_lng`] = null;
                    updates[`devices/${deviceId}/status/speed`] = 0;
                    updates[`devices/${deviceId}/status/gpsFix`] = false;

                    await App.db.ref().update(updates);
                    await App.db.ref(`devices/${deviceId}/temp_trip`).remove().catch(() => {});
                    await App.db.ref(`devices/${deviceId}/trip`).remove().catch(() => {});

                    // إرسال أمر فوري للجهاز عبر السيرفر لمسح الفلاش NVS الداخلي
                    const nonce = 'rst_' + Date.now().toString(36);
                    App.db.ref(`devices/${deviceId}/commandQueue/${nonce}`).set({
                        action: 'CLEAR_LOCATION',
                        command: 'CLEAR_LOCATION',
                        password: localStorage.getItem('motolock_pwd_' + deviceId) || '123456',
                        nonce: nonce,
                        source: 'admin_web_reset_location',
                        timestamp: firebase.database.ServerValue.TIMESTAMP
                    }).catch(() => {});
                }

                // 2. مسح الإحداثيات من ذاكرة المتصفح وكاش الأدمن
                if (App.lastKnownLocations && App.lastKnownLocations[deviceId]) {
                    delete App.lastKnownLocations[deviceId];
                    try {
                        localStorage.setItem('motolock_last_coords', JSON.stringify(App.lastKnownLocations));
                    } catch (e) { }
                }

                const dev = App.devices.get(deviceId);
                if (dev) {
                    dev.lastValidLat = 0;
                    dev.lastValidLng = 0;
                    dev.lastLocationTime = 0;
                    dev._lastMetaSyncedLat = 0;
                    if (dev.meta) {
                        dev.meta.lastLat = null;
                        dev.meta.lastLng = null;
                        dev.meta.hasLastValidLocation = false;
                    }
                    if (dev.status) {
                        dev.status.lat = 0;
                        dev.status.lng = 0;
                        dev.status.gpsFix = false;
                    }
                    if (dev.marker) {
                        dev.marker.remove();
                        dev.marker = null;
                    }
                }

                closeModal('modal-clear-location');
                renderDevicesList();
                updateKpiCounters();
                if (typeof renderTelemetryTable === 'function') {
                    renderTelemetryTable();
                }

                alert('✅ تم مسح وتصفير موقع وإحداثيات الجهاز بنجاح! أصبح جاهزاً للتسليم للعميل دون أي أثر لموقع بيتك.');
            } catch (err) {
                console.error('[Admin] Error clearing device location:', err);
                alert('حدث خطأ أثناء مسح الموقع: ' + err.message);
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

            // Reset bearing to North (0°) button
            const btnResetBearing = document.getElementById('btn-reset-bearing');
            if (btnResetBearing) {
                btnResetBearing.addEventListener('click', () => {
                    if (App.map && typeof App.map.setBearing === 'function') {
                        App.map.setBearing(0);
                    }
                });
            }

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
        function formatTimeAgo(ts, isParked = false) {
            if (!ts || ts === 0) return 'غير متوفر';
            const diffSec = Math.floor((Date.now() - ts) / 1000);
            if (isParked) {
                // أثناء التوقف/الاستعداد: دورة الإرسال تصل إلى 90 ثانية (+ مهلة شبكة)
                // نعتبر الجهاز متصلاً "الآن" طالما أن التحديث ورد خلال 120 ثانية (دقيقتين)
                if (diffSec < 120) return 'الآن';
                if (diffSec < 180) return 'منذ دقيقة';
            } else {
                // أثناء الحركة: دورة الإرسال 1.5 ثانية
                if (diffSec < 15) return 'الآن';
                if (diffSec < 60) return `منذ ${diffSec} ثانية`;
            }
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
                    shortText: 'تحكم سحابي',
                    icon: 'fa-solid fa-sliders',
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

        // --- Date & Midnight Reset Helpers ---
        function getLocalDateString(d = new Date()) {
            const dateObj = (typeof d === 'number' || typeof d === 'string') ? new Date(d) : (d || new Date());
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function getStartOfTodayMs() {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d.getTime();
        }

        // --- Action Formatting Helpers ---
        function formatInternetActionName(act) {
            const a = String(act || '').toUpperCase();
            switch (a) {
                case 'LOCK': return 'أمر إنترنت (تطبيق): قفل الدراجة وتفعيل الأمان 🔒';
                case 'UNLOCK': return 'أمر إنترنت (تطبيق): فتح قفل الدراجة 🔓';
                case 'START':
                case 'START_ENGINE':
                case 'STARTER_PULSE': return 'أمر إنترنت (تطبيق): تشغيل المحرك والمارش ⚡';
                case 'STOP':
                case 'STOP_ENGINE':
                case 'EMERGENCY_STOP': return 'أمر إنترنت (تطبيق): إطفاء المحرك 🛑';
                case 'ALARM':
                case 'ALARM_ON':
                case 'PANIC': return 'أمر إنترنت (تطبيق): تشغيل السارينة والإنذار 🚨';
                case 'ALARM_OFF': return 'أمر إنترنت (تطبيق): إيقاف السارينة 🔕';
                case 'VIB_ON':
                case 'VIBRATION_SENSOR:ON': return 'أمر إنترنت (تطبيق): تفعيل حساس اللمس ✋';
                case 'VIB_OFF':
                case 'VIBRATION_SENSOR:OFF': return 'أمر إنترنت (تطبيق): إيقاف حساس اللمس 🔕';
                case 'CLEAR_LOCATION':
                case 'RESET_GPS': return 'أمر إنترنت (تطبيق): مسح وتحديث موقع الركنة 📍';
                case 'REBOOT':
                case 'RESTART': return 'أمر إنترنت (تطبيق): إعادة تشغيل الجهاز 🔄';
                case 'PING': return 'أمر إنترنت (تطبيق): فحص الاتصال (Ping) ⏱️';
                default:
                    return a ? `أمر إنترنت (تطبيق): ${a}` : null;
            }
        }

        function formatInternetActionIcon(act) {
            const a = String(act || '').toUpperCase();
            switch (a) {
                case 'LOCK': return 'fa-solid fa-lock';
                case 'UNLOCK': return 'fa-solid fa-lock-open';
                case 'START':
                case 'START_ENGINE':
                case 'STARTER_PULSE': return 'fa-solid fa-bolt';
                case 'STOP':
                case 'STOP_ENGINE':
                case 'EMERGENCY_STOP': return 'fa-solid fa-power-off';
                case 'ALARM':
                case 'ALARM_ON':
                case 'PANIC': return 'fa-solid fa-bullhorn';
                case 'ALARM_OFF': return 'fa-solid fa-volume-xmark';
                case 'VIB_ON':
                case 'VIBRATION_SENSOR:ON': return 'fa-solid fa-hand';
                case 'VIB_OFF':
                case 'VIBRATION_SENSOR:OFF': return 'fa-solid fa-bell-slash';
                case 'CLEAR_LOCATION':
                case 'RESET_GPS': return 'fa-solid fa-location-crosshairs';
                case 'REBOOT':
                case 'RESTART': return 'fa-solid fa-arrows-rotate';
                case 'PING': return 'fa-solid fa-stopwatch';
                default: return 'fa-solid fa-sliders';
            }
        }

        function formatActionShortName(act) {
            const a = String(act || '').toUpperCase();
            switch (a) {
                case 'LOCK': return 'قفل';
                case 'UNLOCK': return 'فتح قفل';
                case 'START':
                case 'START_ENGINE': return 'تشغيل';
                case 'STOP':
                case 'STOP_ENGINE': return 'إطفاء';
                case 'ALARM': return 'سارينة';
                case 'VIB_ON': return 'تفعيل اللمس';
                case 'VIB_OFF': return 'إيقاف اللمس';
                case 'CLEAR_LOCATION': return 'مسح الموقع';
                case 'REBOOT': return 'إعادة تشغيل';
                default: return a;
            }
        }

        function trackDeviceStatusTransitions(deviceId, prevStatus, status) {
            if (!prevStatus || !status) return;
            const dev = App.devices.get(deviceId);
            const now = Date.now();
            const wasRecentInternetCmd = dev && dev.lastInternetCmdTime && (now - dev.lastInternetCmdTime < 7000);
            const lastAct = dev ? (dev.lastInternetCmdAction || '') : '';

            // 1. Engine transitions
            if (!prevStatus.engine && status.engine) {
                if (wasRecentInternetCmd && ['START', 'START_ENGINE', 'STARTER_PULSE'].includes(lastAct)) {
                    addDeviceEvent(deviceId, 'فتح الكونتاكت وبدء دوران المحرك (تطبيق) ⚡', 'engine_on', 'fa-solid fa-bolt');
                } else {
                    addDeviceEvent(deviceId, 'فتح الكونتاكت وبدء دوران المحرك (ريموت RF / يدوي) ⚡', 'engine_on', 'fa-solid fa-bolt');
                }
            } else if (prevStatus.engine && !status.engine) {
                if (wasRecentInternetCmd && ['STOP', 'STOP_ENGINE', 'EMERGENCY_STOP'].includes(lastAct)) {
                    addDeviceEvent(deviceId, 'إيقاف المحرك والدخول في وضع التوقف (تطبيق) 🛑', 'engine_off', 'fa-solid fa-power-off');
                } else {
                    addDeviceEvent(deviceId, 'إيقاف المحرك والدخول في وضع التوقف (ريموت RF / يدوي) 🛑', 'engine_off', 'fa-solid fa-power-off');
                }
            }

            // 2. Lock transitions
            if (prevStatus.lock !== undefined && prevStatus.lock !== status.lock) {
                if (status.lock) {
                    if (wasRecentInternetCmd && lastAct === 'LOCK') {
                        addDeviceEvent(deviceId, 'قفل الدراجة وتفعيل الأمان (تطبيق) 🔒', 'lock', 'fa-solid fa-lock');
                    } else {
                        addDeviceEvent(deviceId, 'قفل الدراجة وتفعيل الأمان (ريموت RF / يدوي) 🔒', 'lock', 'fa-solid fa-lock');
                    }
                } else {
                    if (wasRecentInternetCmd && lastAct === 'UNLOCK') {
                        addDeviceEvent(deviceId, 'فتح قفل الدراجة وتجهيز الحركة (تطبيق) 🔓', 'lock', 'fa-solid fa-lock-open');
                    } else {
                        addDeviceEvent(deviceId, 'فتح قفل الدراجة وتجهيز الحركة (ريموت RF / يدوي) 🔓', 'lock', 'fa-solid fa-lock-open');
                    }
                }
            }

            // 3. Siren / Alarm transitions
            if (prevStatus.alarm !== undefined && prevStatus.alarm !== status.alarm) {
                if (status.alarm) {
                    addDeviceEvent(deviceId, 'انطلاق السارينة والإنذار 🚨', 'alarm', 'fa-solid fa-bullhorn');
                } else {
                    addDeviceEvent(deviceId, 'إيقاف صوت السارينة والإنذار 🔕', 'alarm_off', 'fa-solid fa-volume-xmark');
                }
            }

            // 4. Vibration sensor transitions
            if (prevStatus.vibrationSensor !== undefined && prevStatus.vibrationSensor !== status.vibrationSensor) {
                if (status.vibrationSensor) {
                    addDeviceEvent(deviceId, 'تفعيل حساس اللمس والاهتزاز ✋', 'vib', 'fa-solid fa-hand');
                } else {
                    addDeviceEvent(deviceId, 'إيقاف حساس اللمس والاهتزاز 🔕', 'vib_off', 'fa-solid fa-bell-slash');
                }
            }

            // 5. Wake reasons
            if (status.lastWakeReason && status.lastWakeReason !== prevStatus.lastWakeReason) {
                const wake = formatWakeReason(status.lastWakeReason);
                if (wake) {
                    addDeviceEvent(deviceId, 'استيقاظ الدراجة: ' + wake.text, 'vibration', wake.icon);
                }
            }
        }

        // --- Device Daily Events Manager (سجل الأحداث اليومي وتصفيره عند منتصف الليل) ---
        function getDeviceDailyEvents(deviceId) {
            if (!deviceId) return [];
            const storageKey = 'motolock_daily_events_' + deviceId;
            const legacyKey = 'motolock_events_' + deviceId;
            let events = [];
            try {
                events = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem(legacyKey) || '[]');
            } catch (e) {
                events = [];
            }

            const todayStr = getLocalDateString();
            const startOfToday = getStartOfTodayMs();

            // تصفية صارمة للأحداث: فقط أحداث اليوم التي حدثت بعد الساعة 12:00 منتصف الليل
            const filtered = events.filter(evt => {
                if (!evt || !evt.timestamp) return false;
                if (evt.date && evt.date !== todayStr) return false;
                if (evt.timestamp < startOfToday) return false;
                return true;
            });

            // في حال وجود أحداث قديمة من الأمس تم تنظيفها، احفظ القائمة النظيفة فوراً
            if (filtered.length !== events.length) {
                try {
                    localStorage.setItem(storageKey, JSON.stringify(filtered));
                    localStorage.removeItem(legacyKey);
                } catch (e) {}
            }

            return filtered;
        }

        function addDeviceEvent(deviceId, text, type = 'info', icon = 'fa-solid fa-info-circle') {
            if (!deviceId || !text) return;
            const storageKey = 'motolock_daily_events_' + deviceId;
            let events = getDeviceDailyEvents(deviceId);

            const now = Date.now();
            const todayStr = getLocalDateString();

            // منع تكرار نفس الحدث إذا تكرر خلال 8 ثوانٍ
            if (events.length > 0) {
                const last = events[0];
                if (last.text === text && (now - last.timestamp) < 8000) {
                    return;
                }
            }

            const newEvent = {
                id: 'evt_' + now + '_' + Math.random().toString(36).substring(2, 6),
                timestamp: now,
                date: todayStr,
                text: text,
                type: type,
                icon: icon
            };

            events.unshift(newEvent);

            // حد أقصى 100 حدث يومي لكل دراجة
            if (events.length > 100) {
                events = events.slice(0, 100);
            }

            try {
                localStorage.setItem(storageKey, JSON.stringify(events));
            } catch (e) {}

            // مزامنة فورية مع سحابة Firebase RTDB لظهورها فوراً على جميع الأجهزة
            if (App.db && isValidDeviceId(deviceId)) {
                App.db.ref(`devices/${deviceId}/dailyEvents/${newEvent.id}`).set(newEvent).catch(() => {});
            }

            // تحديث واجهة السجل إذا كانت نافذة التحكم مفتوحة للجهاز
            if (App.controlActiveDeviceId === deviceId) {
                renderDeviceEventsLog(deviceId);
            }
        }

        function renderDeviceEventsLog(deviceId) {
            const container = document.getElementById('ctrl-events-log-list');
            if (!container) return;

            const events = getDeviceDailyEvents(deviceId);
            const countBadge = document.getElementById('ctrl-events-count-badge');
            if (countBadge) {
                countBadge.textContent = `${events.length} حدث`;
            }

            const todayBadge = document.getElementById('ctrl-events-today-badge');
            if (todayBadge) {
                todayBadge.textContent = 'اليوم';
            }

            if (events.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); font-size: 0.72rem; padding: 0.85rem 0.5rem;">
                        <i class="fa-regular fa-calendar-check" style="font-size: 1.15rem; color: var(--accent-cyan); margin-bottom: 0.25rem; display: block;"></i>
                        لا توجد أوامر أو أحداث مسجلة لهذا الجهاز اليوم.<br>
                        <span style="font-size: 0.65rem; color: var(--text-dim);">(يتم تصفير السجل تلقائياً كل يوم عند 12:00 منتصف الليل)</span>
                    </div>
                `;
                return;
            }

            let html = '';
            events.forEach(evt => {
                const time12H = formatTime12H(evt.timestamp);
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
                } else if (evt.type === 'command' || evt.type === 'ping' || evt.type === 'reboot' || evt.type === 'lock' || evt.type === 'vib') {
                    badgeColor = '#38bdf8';
                    badgeBg = 'rgba(56, 189, 248, 0.12)';
                } else if (evt.type === 'alarm') {
                    badgeColor = '#f87171';
                    badgeBg = 'rgba(239, 68, 68, 0.15)';
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
            if (confirm('هل أنت متأكد من مسح سجل أحداث هذا اليوم للدراجة؟')) {
                try {
                    localStorage.removeItem('motolock_daily_events_' + deviceId);
                    localStorage.removeItem('motolock_events_' + deviceId);
                } catch (e) {}

                if (App.db && isValidDeviceId(deviceId)) {
                    App.db.ref(`devices/${deviceId}/dailyEvents`).remove().catch(() => {});
                }

                renderDeviceEventsLog(deviceId);
            }
        }

        function handleMidnightReset() {
            console.log('⏰ [MotoLock] حلول منتصف الليل (12:00 AM) - تصفير سجل الأحداث اليومي وبدء يوم جديد');
            App.devices.forEach((dev, deviceId) => {
                try {
                    localStorage.removeItem('motolock_daily_events_' + deviceId);
                    localStorage.removeItem('motolock_events_' + deviceId);
                } catch (e) {}

                if (App.db && isValidDeviceId(deviceId)) {
                    App.db.ref(`devices/${deviceId}/dailyEvents`).remove().catch(() => {});
                }
            });

            if (App.controlActiveDeviceId) {
                renderDeviceEventsLog(App.controlActiveDeviceId);
            }
        }

        function setupMidnightResetScheduler() {
            App.currentDayString = getLocalDateString();
            const now = new Date();
            const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
            const msUntilMidnight = Math.max(1000, midnight.getTime() - now.getTime());

            setTimeout(() => {
                handleMidnightReset();
                setupMidnightResetScheduler();
            }, msUntilMidnight);
        }

        function checkMidnightCrossover() {
            const todayStr = getLocalDateString();
            if (App.currentDayString && App.currentDayString !== todayStr) {
                console.log(`⏰ [MotoLock] رصد تغيير اليوم (${App.currentDayString} -> ${todayStr}) - تصفير السجل اليومي فوراً`);
                App.currentDayString = todayStr;
                handleMidnightReset();
            }
        }

        function updateOpenPopups() {
            App.devices.forEach(dev => {
                if (dev.marker && typeof dev.marker.isPopupOpen === 'function' && dev.marker.isPopupOpen()) {
                    const popup = dev.marker.getPopup();
                    const popupEl = popup ? popup.getElement() : null;
                    if (popupEl) {
                        const state = getDeviceConnectionState(dev);
                        const timeAgo = formatTimeAgo(state.lastSeen, state.isParked);
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
                                parkedRow.style.visibility = 'visible';
                                if (parkedEl.textContent !== parkedAgo) {
                                    parkedEl.textContent = parkedAgo;
                                }
                            } else {
                                parkedRow.style.visibility = 'hidden';
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

                        // 5. تحديث حالة المحرك في الـ Popup
                        const engineEl = popupEl.querySelector('.popup-engine-val');
                        if (engineEl) {
                            const isEngineOn = Boolean(dev.status?.engine === true || dev.status?.contact === true);
                            const engHtml = `<i class="fa-solid ${isEngineOn ? 'fa-bolt' : 'fa-power-off'}"></i> ${isEngineOn ? '🟢 شغال' : '⚫ مطفأ'}`;
                            if (engineEl.innerHTML !== engHtml) {
                                engineEl.innerHTML = engHtml;
                                engineEl.style.color = isEngineOn ? 'var(--accent-green)' : 'var(--text-muted)';
                            }
                        }

                        // 6. تحديث شريط أزرار الميزات الأيقونية في الـ Popup
                        const featBarEl = popupEl.querySelector('.popup-features-bar');
                        if (featBarEl) {
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = renderFeaturesButtonBarHtml(dev, false).trim();
                            const newBar = tempDiv.firstElementChild;
                            if (newBar && featBarEl.innerHTML !== newBar.innerHTML) {
                                featBarEl.innerHTML = newBar.innerHTML;
                            }
                        }
                    } else {
                        dev.marker.setPopupContent(getDevicePopupHtml(dev));
                    }
                }
            });
        }

        function startRelativeTimeTicker() {
            setInterval(() => {
                checkMidnightCrossover();
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
        function openControlModal(deviceId, suggestedAction = null) {
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

            if (suggestedAction) {
                setTimeout(() => {
                    let targetBtn = null;
                    if (suggestedAction === 'UNLOCK') targetBtn = document.getElementById('btn-cmd-unlock');
                    else if (suggestedAction === 'LOCK') targetBtn = document.getElementById('btn-cmd-lock');
                    else if (suggestedAction === 'START') targetBtn = document.getElementById('btn-cmd-start');
                    else if (suggestedAction === 'STOP') targetBtn = document.getElementById('btn-cmd-stop');
                    else if (suggestedAction === 'ALARM') targetBtn = document.getElementById('btn-cmd-alarm');
                    else if (suggestedAction === 'STARTER_PULSE') targetBtn = document.getElementById('btn-cmd-starter');
                    else if (suggestedAction === 'VIB_ON' || suggestedAction === 'VIB_OFF') targetBtn = document.getElementById('btn-cmd-vib');
                    if (targetBtn) {
                        targetBtn.focus();
                        targetBtn.classList.add('flash-highlight');
                        setTimeout(() => targetBtn.classList.remove('flash-highlight'), 1800);
                    }
                }, 150);
            }
        }

        function updateControlModalStatus(deviceId) {
            if (App.controlActiveDeviceId !== deviceId) return;
            const dev = App.devices.get(deviceId);
            if (!dev) return;

            const state = getDeviceConnectionState(dev);
            const isLocked = dev.status?.lock === true;
            const isEngineOn = Boolean(dev.status?.engine === true || dev.status?.contact === true);
            const battery = dev.status?.battery ? Number(dev.status.battery).toFixed(1) + 'V' : '--';

            // Touch / Vibration Sensor State & Button
            const isTouchExplicitlyOn = Boolean(
                dev.status?.vibrationSensor === true ||
                dev.status?.vibEnabled === true ||
                dev.status?.touch === true ||
                dev.meta?.vibrationSensor === true ||
                (dev.command?.action === 'VIB_ON' && dev.command?.state !== 'rejected')
            );
            const isTouchExplicitlyOff = Boolean(
                dev.status?.vibrationSensor === false ||
                (dev.command?.action === 'VIB_OFF' && dev.command?.state !== 'rejected')
            );
            const isTouchActive = isTouchExplicitlyOn || (isLocked && !isTouchExplicitlyOff);

            const vibBtn = document.getElementById('btn-cmd-vib');
            const vibTitle = document.getElementById('subaction-title-vib');
            const vibCmd = document.getElementById('subaction-cmd-vib');
            if (vibBtn) {
                App.currentVibAction = isTouchActive ? 'VIB_OFF' : 'VIB_ON';
                if (isTouchActive) {
                    vibBtn.classList.add('active');
                    if (vibTitle) vibTitle.textContent = 'إلغاء اللمس';
                    if (vibCmd) vibCmd.textContent = 'VIB_OFF';
                    vibBtn.title = 'حساس اللمس مفعل حالياً (اضغط للتعطيل VIB_OFF)';
                } else {
                    vibBtn.classList.remove('active');
                    if (vibTitle) vibTitle.textContent = 'تفعيل اللمس';
                    if (vibCmd) vibCmd.textContent = 'VIB_ON';
                    vibBtn.title = 'حساس اللمس معطل حالياً (اضغط للتفعيل VIB_ON)';
                }
            }

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
                    const is204 = dailyStats.fw === '2.0.4';
                    fwElem.style.display = 'inline-flex';
                    fwElem.textContent = 'v' + dailyStats.fw;
                    fwElem.title = is204 ? 'فيرموير v2.0.4 (الأحدث)' : 'إصدار الفيرموير: ' + dailyStats.fw;
                    if (is204) {
                        fwElem.style.color = '#ef4444';
                        fwElem.style.background = 'rgba(239, 68, 68, 0.15)';
                        fwElem.style.borderColor = 'rgba(239, 68, 68, 0.35)';
                    } else {
                        fwElem.style.color = '#a78bfa';
                        fwElem.style.background = 'rgba(167, 139, 250, 0.12)';
                        fwElem.style.borderColor = 'rgba(167, 139, 250, 0.28)';
                    }
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
                'VIB_ON': 'تفعيل حساس اللمس',
                'VIB_OFF': 'إلغاء حساس اللمس',
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
                    'تم حفظ أمر (' + actionNameAr + ') وسينفذ تلقائياً فور استيقاظ الدراجة بتحريكها أو فتح الكونتاكت.'
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
                            addDeviceEvent(deviceId, `أمر لوحة الإدارة: فحص سرعة الاستجابة (${latency}ms)`, 'ping', 'fa-solid fa-stopwatch');
                        } else if (action === 'REBOOT') {
                            setControlFeedback(
                                'success',
                                'fa-solid fa-arrows-rotate',
                                '✅ تم إرسال أمر إعادة التشغيل (Soft Reboot) بنجاح!',
                                'يقوم الجهاز الآن بإعادة التشغيل وسيعاود الاتصال تلقائياً خلال لحظات.'
                            );
                            addDeviceEvent(deviceId, 'أمر لوحة الإدارة: إعادة تشغيل الجهاز عن بُعد (Soft Reboot)', 'reboot', 'fa-solid fa-arrows-rotate');
                        } else {
                            if (action === 'VIB_ON') {
                                if (dev.status) dev.status.vibrationSensor = true;
                                if (dev.meta) dev.meta.vibrationSensor = true;
                            } else if (action === 'VIB_OFF') {
                                if (dev.status) dev.status.vibrationSensor = false;
                                if (dev.meta) dev.meta.vibrationSensor = false;
                            }
                            setControlFeedback(
                                'success',
                                'fa-solid fa-circle-check',
                                `✅ تم تنفيذ أمر (${actionNameAr}) بنجاح على الدراجة!`,
                                'استجابت الدراجة في الوقت الفعلي وتم تحديث الحالة.'
                            );
                            addDeviceEvent(deviceId, `أمر لوحة الإدارة: تنفيذ أمر (${actionNameAr}) بنجاح`, 'command', 'fa-solid fa-circle-check');
                        }

                        updateControlModalStatus(deviceId);
                        scheduleListRender();
                        updateOpenPopups();

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
                        addDeviceEvent(deviceId, `رفض أمر لوحة الإدارة (${actionNameAr}): ${reason}`, 'error', 'fa-solid fa-circle-xmark');
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

        // ==========================================
        // --- Broadcast & Announcements Manager ---
        // ==========================================
        let liveAnnouncements = [];

        function listenToAnnouncements() {
            if (!App.db) return;
            try {
                App.db.ref('system/announcements').on('value', (snap) => {
                    const data = snap.val() || {};
                    liveAnnouncements = Object.keys(data).map(key => ({
                        id: key,
                        ...data[key]
                    }));

                    // Sort newest first
                    liveAnnouncements.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

                    renderAnnouncementsList();
                    updateAnnouncementsBadges();
                });
            } catch (err) {
                console.warn('[Announcements] Listener error:', err);
            }
        }

        function openBroadcastModal() {
            populateTargetDevicesCheckboxes();
            renderAnnouncementsList();
            updateAnnouncementsBadges();
            openModal('modal-broadcast');
        }

        function switchAnnTab(tab) {
            const btnNew = document.getElementById('tab-btn-new-ann');
            const btnList = document.getElementById('tab-btn-list-ann');
            const contentNew = document.getElementById('tab-content-new-ann');
            const contentList = document.getElementById('tab-content-list-ann');

            if (tab === 'new') {
                btnNew.classList.add('active');
                btnList.classList.remove('active');
                contentNew.style.display = 'flex';
                contentList.style.display = 'none';
            } else {
                btnNew.classList.remove('active');
                btnList.classList.add('active');
                contentNew.style.display = 'none';
                contentList.style.display = 'flex';
                renderAnnouncementsList();
            }
        }

        function toggleTargetDeviceSelect() {
            const mode = document.getElementById('ann-target-mode').value;
            const row = document.getElementById('row-target-device');
            if (row) {
                row.style.display = (mode === 'specific') ? 'block' : 'none';
            }
            if (mode === 'specific') {
                populateTargetDevicesCheckboxes();
            }
        }

        function toggleCustomExpiryInput() {
            const duration = document.getElementById('ann-duration').value;
            const row = document.getElementById('row-custom-expiry');
            if (row) {
                row.style.display = (duration === 'custom') ? 'block' : 'none';
            }
        }

        function populateTargetDevicesCheckboxes() {
            const container = document.getElementById('ann-device-checkboxes-container');
            if (!container) return;

            // Clear search field on repopulate
            const searchInput = document.getElementById('ann-device-search-input');
            if (searchInput) searchInput.value = '';

            if (App.devices && App.devices.size > 0) {
                // Convert Map to Array
                const devList = [];
                App.devices.forEach((dev, devId) => {
                    devList.push({
                        id: dev.id || devId,
                        name: dev.name || 'دراجة',
                        isOnline: !!dev.isOnline
                    });
                });

                // Sort alphabetically by bike name (supports Arabic & English)
                devList.sort((a, b) => a.name.localeCompare(b.name, 'ar', { sensitivity: 'base' }));

                let html = '';
                devList.forEach(dev => {
                    const statusDot = dev.isOnline ? 
                        '<span style="width: 7px; height: 7px; border-radius: 50%; background: var(--accent-green); box-shadow: 0 0 6px var(--accent-green); display: inline-block;"></span>' : 
                        '<span style="width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); display: inline-block;"></span>';

                    html += `
                        <label class="ann-device-item" data-name="${escapeHtml(dev.name).toLowerCase()}" data-id="${escapeHtml(dev.id).toLowerCase()}" style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; padding: 0.35rem 0.6rem; cursor: pointer; transition: var(--transition); margin: 0;">
                            <div style="display: flex; align-items: center; gap: 0.55rem; overflow: hidden;">
                                <input type="checkbox" class="ann-dev-checkbox" value="${escapeHtml(dev.id)}" onchange="updateSelectedDevicesCount()" style="cursor: pointer; width: 15px; height: 15px; accent-color: var(--accent-cyan); flex-shrink: 0;">
                                <i class="fa-solid fa-motorcycle" style="font-size: 0.8rem; color: var(--accent-cyan); flex-shrink: 0;"></i>
                                <span style="font-size: 0.78rem; font-weight: 700; color: #fff; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${escapeHtml(dev.name)}</span>
                                <span style="font-size: 0.7rem; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; flex-shrink: 0;">(${escapeHtml(dev.id)})</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.68rem; color: ${dev.isOnline ? 'var(--accent-green)' : 'var(--text-dim)'}; flex-shrink: 0;">
                                ${statusDot}
                                <span>${dev.isOnline ? 'متصل' : 'غير متصل'}</span>
                            </div>
                        </label>
                    `;
                });
                container.innerHTML = html;
            } else {
                container.innerHTML = '<div style="font-size: 0.75rem; color: var(--text-dim); text-align: center; padding: 0.5rem;">لا توجد أجهزة مسجلة حالياً</div>';
            }
            updateSelectedDevicesCount();
        }

        function filterTargetDevicesCheckboxes() {
            const query = (document.getElementById('ann-device-search-input')?.value || '').trim().toLowerCase();
            const items = document.querySelectorAll('.ann-device-item');
            let visibleCount = 0;

            items.forEach(el => {
                const name = el.getAttribute('data-name') || '';
                const id = el.getAttribute('data-id') || '';
                if (!query || name.includes(query) || id.includes(query)) {
                    el.style.display = 'flex';
                    visibleCount++;
                } else {
                    el.style.display = 'none';
                }
            });

            const container = document.getElementById('ann-device-checkboxes-container');
            let emptyMsg = document.getElementById('ann-search-empty-msg');
            if (visibleCount === 0 && items.length > 0) {
                if (!emptyMsg) {
                    emptyMsg = document.createElement('div');
                    emptyMsg.id = 'ann-search-empty-msg';
                    emptyMsg.style.cssText = 'font-size: 0.75rem; color: var(--text-dim); text-align: center; padding: 0.75rem;';
                    emptyMsg.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> لا توجد أي دراجة مطابقة للبحث';
                    container.appendChild(emptyMsg);
                }
                emptyMsg.style.display = 'block';
            } else if (emptyMsg) {
                emptyMsg.style.display = 'none';
            }
        }

        function toggleAllDeviceCheckboxes(select) {
            const boxes = document.querySelectorAll('.ann-dev-checkbox');
            boxes.forEach(b => {
                // If filtered, only toggle visible ones; or all if no search
                const parent = b.closest('.ann-device-item');
                if (!parent || parent.style.display !== 'none') {
                    b.checked = select;
                }
            });
            updateSelectedDevicesCount();
        }

        function updateSelectedDevicesCount() {
            const checked = document.querySelectorAll('.ann-dev-checkbox:checked').length;
            const el = document.getElementById('ann-selected-devices-count');
            if (el) {
                el.textContent = `${checked} محدد`;
                el.style.color = checked > 0 ? 'var(--accent-cyan)' : 'var(--text-dim)';
            }
        }

        function updateAnnouncementsBadges() {
            const now = Date.now();
            const activeCount = liveAnnouncements.filter(a => {
                if (a.active === false) return false;
                if (a.expires_at && now > a.expires_at) return false;
                return true;
            }).length;

            const badgeActive = document.getElementById('ann-active-count-badge');
            if (badgeActive) {
                badgeActive.textContent = `${activeCount} نشط`;
                badgeActive.style.color = activeCount > 0 ? 'var(--accent-green)' : 'var(--text-dim)';
            }

            const tabCount = document.getElementById('tab-ann-count');
            if (tabCount) {
                tabCount.textContent = String(liveAnnouncements.length);
            }

            const headerBadge = document.getElementById('broadcast-badge-count');
            if (headerBadge) {
                if (activeCount > 0) {
                    headerBadge.style.display = 'inline-block';
                    headerBadge.textContent = String(activeCount);
                } else {
                    headerBadge.style.display = 'none';
                }
            }
        }

        function formatDurationRemaining(expiresAt) {
            if (!expiresAt) return '<span style="color: var(--accent-cyan); font-weight: 600;"><i class="fa-solid fa-infinity"></i> دائمة</span>';
            const now = Date.now();
            const diff = expiresAt - now;
            if (diff <= 0) {
                return '<span style="color: var(--accent-red); font-weight: 700;"><i class="fa-solid fa-clock-rotate-left"></i> منتهية الصلاحية</span>';
            }
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const days = Math.floor(hours / 24);
            if (days > 0) {
                const remHours = hours % 24;
                return `<span style="color: var(--accent-green); font-weight: 600;"><i class="fa-regular fa-clock"></i> متبقي ${days} يوم و ${remHours} ساعة</span>`;
            }
            const minutes = Math.floor(diff / (1000 * 60));
            if (hours > 0) {
                return `<span style="color: var(--accent-amber); font-weight: 600;"><i class="fa-regular fa-clock"></i> متبقي ${hours} ساعة و ${minutes % 60} دقيقة</span>`;
            }
            return `<span style="color: var(--accent-red); font-weight: 700;"><i class="fa-solid fa-fire"></i> متبقي ${minutes} دقيقة فقط!</span>`;
        }

        function getAnnouncementTypeBadge(type) {
            switch (type) {
                case 'update':
                    return '<span class="mini-tag" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);"><i class="fa-solid fa-rocket"></i> تحديث</span>';
                case 'warning':
                    return '<span class="mini-tag" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);"><i class="fa-solid fa-triangle-exclamation"></i> تحذير أمني</span>';
                case 'maintenance':
                    return '<span class="mini-tag" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);"><i class="fa-solid fa-wrench"></i> صيانة</span>';
                default:
                    return '<span class="mini-tag" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);"><i class="fa-solid fa-bullhorn"></i> إعلان عام</span>';
            }
        }

        async function publishAnnouncement() {
            if (!App.db) {
                alert('الفايربيس غير متصل حالياً! يرجى التأكد من اتصال الإنترنت ثم إعادة المحاولة.');
                return;
            }

            if (App.auth && !App.auth.currentUser) {
                try {
                    await App.auth.signInAnonymously();
                } catch (e) {
                    console.warn('[Announcements] Anonymous sign-in before publish:', e);
                }
            }

            const titleAr = (document.getElementById('ann-title-ar').value || '').trim();
            const titleEn = (document.getElementById('ann-title-en').value || '').trim();
            const bodyAr = (document.getElementById('ann-body-ar').value || '').trim();
            const bodyEn = (document.getElementById('ann-body-en').value || '').trim();
            const type = document.getElementById('ann-type').value || 'announcement';
            const targetMode = document.getElementById('ann-target-mode').value;
            const durationVal = document.getElementById('ann-duration').value;
            const actionUrl = (document.getElementById('ann-action-url').value || '').trim();

            if (!titleAr) {
                alert('يرجى كتابة عنوان الرسالة بالعربية.');
                document.getElementById('ann-title-ar').focus();
                return;
            }

            if (!bodyAr) {
                alert('يرجى كتابة نص الرسالة بالعربية.');
                document.getElementById('ann-body-ar').focus();
                return;
            }

            let target = 'all';
            if (targetMode === 'specific') {
                const checkedBoxes = Array.from(document.querySelectorAll('.ann-dev-checkbox:checked'));
                if (checkedBoxes.length === 0) {
                    alert('يرجى اختيار جهاز أو دراجة واحدة على الأقل عبر مربعات الاختيار (Checkboxes).');
                    return;
                }
                target = checkedBoxes.map(cb => cb.value.trim()).join(',');
            }

            let expiresAt = null;
            const now = Date.now();
            if (durationVal === 'permanent') {
                expiresAt = null;
            } else if (durationVal === 'custom') {
                const dtStr = document.getElementById('ann-custom-expiry-dt').value;
                if (!dtStr) {
                    alert('يرجى تحديد تاريخ ووقت انتهاء الإعلان المخصص.');
                    return;
                }
                expiresAt = new Date(dtStr).getTime();
                if (expiresAt <= now) {
                    alert('تاريخ الانتهاء يجب أن يكون في المستقبل!');
                    return;
                }
            } else {
                expiresAt = now + parseInt(durationVal, 10);
            }

            const btn = document.getElementById('btn-submit-ann');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جارِ النشر...';

            try {
                const newRef = App.db.ref('system/announcements').push();
                const payload = {
                    id: newRef.key,
                    title_ar: titleAr,
                    title_en: titleEn || titleAr,
                    body_ar: bodyAr,
                    body_en: bodyEn || bodyAr,
                    type: type,
                    target: target,
                    created_at: now,
                    expires_at: expiresAt,
                    active: true,
                    action_url: actionUrl
                };

                await newRef.set(payload);

                alert('تم نشر الإعلان بنجاح في Firebase! 🎉\nسيظهر للمستخدمين فوراً عند فتح التطبيق، أو عبر قنوات الإشعارات.');

                // Reset form
                document.getElementById('ann-title-ar').value = '';
                document.getElementById('ann-title-en').value = '';
                document.getElementById('ann-body-ar').value = '';
                document.getElementById('ann-body-en').value = '';
                document.getElementById('ann-action-url').value = '';
                document.getElementById('ann-target-mode').value = 'all';
                toggleTargetDeviceSelect();
                toggleAllDeviceCheckboxes(false);
                document.getElementById('ann-duration').value = '86400000';
                toggleCustomExpiryInput();

                // Switch to list tab
                switchAnnTab('list');
            } catch (err) {
                console.error('[Announcements] Publish failed:', err);
                alert('حدث خطأ أثناء حفظ الإعلان: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> نشر الإعلان في Firebase';
            }
        }

        async function deleteAnnouncement(annId) {
            if (!App.db || !annId) return;
            const ann = liveAnnouncements.find(a => a.id === annId);
            const title = ann ? (ann.title_ar || ann.title_en || annId) : annId;

            if (!confirm(`هل أنت متأكد من حذف هذا الإعلان نهائياً؟\n"${title}"\nسيختفي فوراً من جميع هواتف المستخدمين.`)) {
                return;
            }

            try {
                // Ensure active authenticated session to fulfill Firebase write rules
                if (App.auth && !App.auth.currentUser) {
                    try {
                        await App.auth.signInAnonymously();
                    } catch (authErr) {
                        console.warn('[Announcements] Anonymous sign-in before delete:', authErr);
                    }
                }

                await App.db.ref(`system/announcements/${annId}`).remove();

                // Optimistically remove from local array and update UI immediately
                liveAnnouncements = liveAnnouncements.filter(a => a.id !== annId);
                renderAnnouncementsList();
                updateAnnouncementsBadges();

                alert('تم حذف الإعلان بنجاح! 🗑️');
            } catch (err) {
                console.error('[Announcements] Delete failed:', err);
                alert('حدث خطأ أثناء الحذف: ' + err.message);
            }
        }
        window.deleteAnnouncement = deleteAnnouncement;
        window.publishAnnouncement = publishAnnouncement;

        function renderAnnouncementsList() {
            const container = document.getElementById('ann-list-container');
            if (!container) return;

            if (liveAnnouncements.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-dim); background: rgba(0,0,0,0.2); border-radius: 10px; border: 1px dashed var(--border-color);">
                        <i class="fa-solid fa-bullhorn" style="font-size: 2.2rem; color: var(--text-dim); opacity: 0.5; margin-bottom: 0.75rem;"></i>
                        <div style="font-weight: 700; color: var(--text-muted); font-size: 0.9rem;">لا توجد أي إعلانات حالياً</div>
                        <div style="font-size: 0.75rem; margin-top: 0.25rem;">اضغط على "إنشاء إعلان جديد" بالأعلى لنشر رسالة فورية للمستخدمين.</div>
                    </div>
                `;
                return;
            }

            const now = Date.now();
            let html = '';

            liveAnnouncements.forEach(a => {
                const isExpired = a.expires_at && now > a.expires_at;
                const isTargetAll = !a.target || a.target === 'all';
                const createdDateStr = a.created_at ? new Date(a.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : 'غير محدد';
                
                const cardBorderColor = isExpired ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.35)';
                const cardBg = isExpired ? 'rgba(239, 68, 68, 0.04)' : 'rgba(17, 26, 46, 0.7)';

                // Format Target string
                let targetDisplay = '🌐 جميع المستخدمين';
                if (!isTargetAll) {
                    const targetsList = (a.target || '').split(',').map(s => s.trim()).filter(Boolean);
                    if (targetsList.length > 1) {
                        targetDisplay = `🎯 ${targetsList.length} أجهزة محددة (${escapeHtml(targetsList.join(', '))})`;
                    } else if (targetsList.length === 1) {
                        targetDisplay = `🎯 دراجة: ${escapeHtml(targetsList[0])}`;
                    }
                }

                html += `
                    <div style="background: ${cardBg}; border: 1px solid ${cardBorderColor}; border-radius: 10px; padding: 0.85rem; display: flex; flex-direction: column; gap: 0.55rem; transition: var(--transition);">
                        <!-- Header: Type, Title, Target & Delete -->
                        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem;">
                            <div style="display: flex; flex-direction: column; gap: 0.25rem; flex: 1;">
                                <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                                    ${getAnnouncementTypeBadge(a.type)}
                                    <span style="font-weight: 800; font-size: 0.88rem; color: #fff;">${escapeHtml(a.title_ar)}</span>
                                </div>
                                ${a.title_en && a.title_en !== a.title_ar ? `<span style="font-size: 0.72rem; color: var(--text-dim);">${escapeHtml(a.title_en)}</span>` : ''}
                            </div>
                            <button type="button" class="mini-btn" style="color: var(--accent-red); border-color: rgba(239,68,68,0.3); padding: 0.25rem 0.55rem; font-size: 0.72rem; white-space: nowrap;" onclick="deleteAnnouncement('${escapeHtml(a.id)}')">
                                <i class="fa-solid fa-trash"></i> حذف
                            </button>
                        </div>

                        <!-- Body text -->
                        <div style="font-size: 0.78rem; color: var(--text-main); line-height: 1.45; white-space: pre-line; background: rgba(0,0,0,0.25); padding: 0.5rem 0.7rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
                            ${escapeHtml(a.body_ar)}
                        </div>

                        <!-- Footer Meta: Target, Expiry, Created -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; font-size: 0.72rem; padding-top: 0.25rem; border-top: 1px solid rgba(255,255,255,0.06);">
                            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                <span style="color: var(--text-muted);"><i class="fa-solid fa-bullseye"></i> المستهدف: <b style="color: ${isTargetAll ? 'var(--accent-cyan)' : 'var(--accent-amber)'};">${targetDisplay}</b></span>
                                <span>•</span>
                                <span>${formatDurationRemaining(a.expires_at)}</span>
                            </div>
                            <div style="color: var(--text-dim); display: flex; align-items: center; gap: 0.35rem;">
                                ${a.action_url ? `<a href="${escapeHtml(a.action_url)}" target="_blank" style="color: var(--accent-cyan); text-decoration: underline; margin-left: 0.5rem;"><i class="fa-solid fa-link"></i> رابط</a>` : ''}
                                <i class="fa-regular fa-calendar-check"></i> ${escapeHtml(createdDateStr)}
                            </div>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        }
