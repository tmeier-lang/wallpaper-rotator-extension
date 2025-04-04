// extension.js - Main extension file
// Added Pango to imports
const { GObject, St, Gio, GLib, Clutter, Pango } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension(); // Me provides info about the current extension

// Default configuration
const DEFAULT_INTERVAL = 60; // minutes
const DEFAULT_WALLPAPER_DIR = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);

// --- Icon Filenames ---
const ICON_LIGHT = 'icon-light.svg'; // Icon for dark themes (light icon color)
const ICON_DARK = 'icon-dark.svg';   // Icon for light themes (dark icon color)

let wallpaperRotator = null;

const WallpaperRotator = GObject.registerClass(
class WallpaperRotator extends PanelMenu.Button {
    _init() {
        super._init(0.0, "Wallpaper Rotator");

        // Initialize instance variables
        this._wallpaperDir = DEFAULT_WALLPAPER_DIR;
        this._wallpapers = [];
        this._currentIndex = 0;
        this._interval = DEFAULT_INTERVAL;
        this._isRunning = false;
        this._settings = null; // Init later
        this._lastChangeTime = 0;
        this._timeout = null;
        this._extensionSettings = null;
        this._interfaceSettings = null; // For color scheme
        this._colorSchemeMonitorId = null; // ID for listener
        this._settingsChangedId = null;
        this._statusLabel = null; // Init in _createMenu
        this._rotationSwitch = null; // Init in _createMenu

        // Create icon with system icon initially (fallback)
        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_name: 'image-x-generic-symbolic', // Start with a working system icon
            icon_size: 16
        });
        this.add_child(this._icon);

        // Load extension settings
        this._loadSettings();
        // Load desktop settings
        this._settings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });

        // Setup interface monitoring for theme changes
        try {
            this._interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
            // Listen for changes to the color-scheme setting
            this._colorSchemeMonitorId = this._interfaceSettings.connect(
                'changed::color-scheme',
                this._updatePanelIcon.bind(this)
            );
            // Initial icon load based on current scheme
            this._updatePanelIcon();
        } catch (e) {
            logError(e, "Wallpaper Rotator: Failed to monitor interface settings. Using default icon.");
            // Fallback icon already set in initialization
        }

        // Create menu items
        this._createMenu();

        // Load wallpapers
        this._loadWallpapers();
    }

    // Update Panel Icon based on Color Scheme
    _updatePanelIcon() {
        let useLight = false;
        try {
            // Determine which icon to use based on theme
            if (this._interfaceSettings && this._interfaceSettings.get_string) {
                const colorScheme = this._interfaceSettings.get_string('color-scheme');
                useLight = (colorScheme === 'prefer-dark');
                 // log(`Wallpaper Rotator: Theme scheme: ${colorScheme}, using ${useLight ? 'light' : 'dark'} icon`); // Keep commented unless debugging
            } else if (Main.panel && Main.panel.get_theme_node) {
                const themeNode = Main.panel.get_theme_node();
                const backgroundColor = themeNode.get_background_color();
                const luminance = 0.299*backgroundColor.red + 0.587*backgroundColor.green + 0.114*backgroundColor.blue;
                useLight = (luminance < 128);
                 // log(`Wallpaper Rotator: Theme detection via panel color, using ${useLight ? 'light' : 'dark'} icon`); // Keep commented unless debugging
            }
            const iconFileName = useLight ? ICON_LIGHT : ICON_DARK;
            if (!Me || !Me.path) { logError(new Error("Extension path not available")); this._setDefaultPanelIcon(); return; }
            const iconPath = GLib.build_filenamev([Me.path, iconFileName]);
            // log(`Wallpaper Rotator: Attempting to load icon from: ${iconPath}`); // Keep commented unless debugging
            const iconFile = Gio.File.new_for_path(iconPath);
            if (!iconFile.query_exists(null)) {
                logError(new Error(`Icon file not found: ${iconPath}`)); // Log actual error
                this._setDefaultPanelIcon();
                return;
            }
            // log(`Wallpaper Rotator: Icon file exists, creating Gio.FileIcon`); // Keep commented unless debugging
            const fileIcon = Gio.FileIcon.new(iconFile);
            if (!fileIcon) {
                logError(new Error(`Failed to create FileIcon for ${iconPath}`)); // Log actual error
                this._setDefaultPanelIcon();
                return;
            }
            this._icon.icon_name = null;
            this._icon.gicon = fileIcon;
            // log(`Wallpaper Rotator: Successfully set custom icon`); // Keep commented unless debugging
        } catch (e) {
            logError(e, `Wallpaper Rotator: Error updating panel icon`);
            this._setDefaultPanelIcon();
        }
    }

    // Set a fallback system icon
    _setDefaultPanelIcon() {
        if (this._icon) {
            this._icon.gicon = null; // Clear custom icon
            const fallbackIcons = [ 'image-x-generic-symbolic', 'preferences-desktop-wallpaper-symbolic', 'document-new-symbolic', 'folder-pictures-symbolic' ];
            for (const iconName of fallbackIcons) {
                try {
                    this._icon.icon_name = iconName;
                     log(`Wallpaper Rotator: Using fallback icon ${iconName}`);
                    return;
                } catch (e) {
                    // log(`Wallpaper Rotator: Fallback icon ${iconName} failed, trying next.`); // Can be noisy
                    continue;
                }
            }
            try { this._icon.icon_name = 'application-x-executable-symbolic'; log("Wallpaper Rotator: Using last resort fallback icon"); }
            catch(e) { logError(e, "Failed to set even last resort fallback icon."); }
        } else { logError(new Error("Wallpaper Rotator: Cannot set fallback icon, icon widget is null")); }
    }

    _createMenu() {
        this.menu.removeAll();

        // Status Item (Using PopupBaseMenuItem + St.BoxLayout + St.Label)
        this._statusItemContainer = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this.menu.addMenuItem(this._statusItemContainer);
        let labelContainer = new St.BoxLayout({ style_class: 'popup-menu-item-actor-content', style: 'max-width: 350px;' });
        this._statusItemContainer.actor.add_child(labelContainer);
        this._statusLabel = new St.Label({ text: 'Loading...' });
        this._statusLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.MIDDLE);
        this._statusLabel.x_expand = false;
        labelContainer.add_child(this._statusLabel);
        // --- End Status Item ---

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Direct Controls Row ---
        const controlsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this.menu.addMenuItem(controlsItem);
        const controlsBox = new St.BoxLayout({});
        controlsItem.actor.add_child(controlsBox);
        const createControlButton = (iconName, accessibleName, callback) => { /* ... same as before ... */
            const icon = new St.Icon({ icon_name: iconName, style_class: 'popup-menu-icon' });
            const button = new St.Button({ child: icon, style_class: 'button popup-menu-button', can_focus: true, reactive: true, accessible_name: accessibleName });
            button.connect('clicked', callback); return button;
        };
        const prevButton = createControlButton('media-skip-backward-symbolic', 'Previous Wallpaper', this._onPreviousActivated.bind(this));
        const nextButton = createControlButton('media-skip-forward-symbolic', 'Next Wallpaper', this._onNextActivated.bind(this));
        const randomButton = createControlButton('view-refresh-symbolic', 'Random Wallpaper', this._onRandomActivated.bind(this));
        controlsBox.add_child(prevButton);
        controlsBox.add_child(new St.Widget({ x_expand: true }));
        controlsBox.add_child(randomButton);
        controlsBox.add_child(new St.Widget({ x_expand: true }));
        controlsBox.add_child(nextButton);
        // --- End of Direct Controls Row ---

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Auto-rotation toggle
        const intervalText = (this._interval > 0) ? `${this._interval} min` : 'N/A';
        const initialSwitchLabel = this._isRunning ? `Every ${intervalText}` : `Interval: ${intervalText}`;
        this._rotationSwitch = new PopupMenu.PopupSwitchMenuItem(`Auto-Rotate (${initialSwitchLabel})`, this._isRunning);
        this._rotationSwitch.connect('toggled', this._onRotationToggled.bind(this));
        this.menu.addMenuItem(this._rotationSwitch);

        // Refresh wallpapers item
        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Wallpaper List');
        refreshItem.connect('activate', this._onRefreshActivated.bind(this));
        this.menu.addMenuItem(refreshItem);

        // Settings button
        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', this._onSettingsActivated.bind(this));
        this.menu.addMenuItem(settingsItem);

        this._updateStatus();
        this._updateRotationSwitchLabel();
    }

    _updateRotationSwitchLabel() { /* ... same as before ... */
        if (this._rotationSwitch && this._rotationSwitch.label) {
             const intervalText = (this._interval > 0) ? `${this._interval} min` : 'N/A';
             const stateText = this._isRunning ? `Every ${intervalText}` : `Interval: ${intervalText}`;
             this._rotationSwitch.label.text = `Auto-Rotate (${stateText})`;
        }
    }
    _loadSettings() { /* ... same as before ... */
        try {
             if (!this._extensionSettings) { this._extensionSettings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator'); }
            const dirValue = this._extensionSettings.get_string('wallpaper-directory');
            this._wallpaperDir = (dirValue && dirValue !== '') ? dirValue : DEFAULT_WALLPAPER_DIR;
             // Log only if needed: log(`Wallpaper Rotator: Using directory: ${this._wallpaperDir}`);
            this._interval = this._extensionSettings.get_int('interval');
            if (this._interval <= 0) { this._interval = DEFAULT_INTERVAL; }
             // Log only if needed: log(`Wallpaper Rotator: Loaded interval setting: ${this._interval}`);
            if (!this._settingsChangedId) { this._settingsChangedId = this._extensionSettings.connect('changed', this._onSettingsChanged.bind(this)); }
        } catch (e) { logError(e, `Wallpaper Rotator: Error loading settings`); this._wallpaperDir = DEFAULT_WALLPAPER_DIR; this._interval = DEFAULT_INTERVAL; }
    }
    _loadWallpapers() { /* ... same as before ... */
        // log(`Wallpaper Rotator: Loading wallpapers from ${this._wallpaperDir}`); // Less verbose logging
        this._wallpapers = []; this._currentIndex = 0; let loadError = null;
        try { const dir = Gio.File.new_for_path(this._wallpaperDir); if (!dir.query_exists(null)) { loadError = "Directory not found"; } else { const enumerator = dir.enumerate_children('standard::name,standard::type,standard::is-hidden', Gio.FileQueryInfoFlags.NONE, null); const supportedExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']; let info; while ((info = enumerator.next_file(null))) { if (info.get_is_hidden()) continue; const name = info.get_name(); if (supportedExtensions.some(ext => name.toLowerCase().endsWith(ext))) { this._wallpapers.push(GLib.build_filenamev([this._wallpaperDir, name])); } } enumerator.close(null); log(`Wallpaper Rotator: Found ${this._wallpapers.length} wallpapers`); if (this._wallpapers.length > 0) { try { const currentWallpaperUri = this._settings.get_string('picture-uri'); if (currentWallpaperUri && GLib.uri_is_valid(currentWallpaperUri, GLib.UriFlags.NONE)) { const [success, currentPath] = GLib.filename_from_uri(currentWallpaperUri); if (success && currentPath) { const index = this._wallpapers.indexOf(currentPath); if (index >= 0) { this._currentIndex = index; } } } } catch (e) { /* Non-critical error */ } } } }
        catch (e) { loadError = `Error: ${e.message}`; logError(e, `Wallpaper Rotator: Error loading wallpapers`); }
        finally { this._updateStatus(loadError); if (this._isRunning && (!this._wallpapers || this._wallpapers.length <= 1)) { this._stopRotation(); if (this._rotationSwitch) this._rotationSwitch.setToggleState(false); } this._updateRotationSwitchLabel(); }
    }

    // *** Updated: Display only counts ***
    _updateStatus(message = null) {
        if (!this._statusLabel) return;

        if (message) {
            this._statusLabel.text = message;
            return;
        }

        if (!this._wallpapers || this._wallpapers.length === 0) {
            try {
                const dir = Gio.File.new_for_path(this._wallpaperDir);
                this._statusLabel.text = dir.query_exists(null) ? 'No supported images' : 'Directory not found';
            } catch (e) {
                this._statusLabel.text = 'Directory error';
            }
            return;
        }
        // Show only index/count
        this._statusLabel.text = `(${this._currentIndex + 1} / ${this._wallpapers.length})`;
    }

    _setWallpaper(path) { /* ... same as before ... */
        try { const file = Gio.File.new_for_path(path); if (!file.query_exists(null)) { log(`Wallpaper Rotator: File not found: ${path}. Removing from list.`); this._wallpapers.splice(this._currentIndex, 1); if (this._currentIndex >= this._wallpapers.length) this._currentIndex = 0; this._updateStatus(`Error: Image file not found`); return false; } const uri = file.get_uri(); log(`Wallpaper Rotator: Setting wallpaper to: ${uri}`); this._settings.set_string('picture-uri', uri); this._settings.set_string('picture-uri-dark', uri); this._lastChangeTime = GLib.get_monotonic_time() / 1000000; this._updateStatus(); return true; }
        catch (e) { logError(e, `Wallpaper Rotator: Error setting wallpaper`); this._updateStatus(`Error setting wallpaper`); return false; }
    }
    _changeWallpaper(newIndex) { /* ... same as before ... */
         if (!this._wallpapers || this._wallpapers.length === 0) { log("Wallpaper Rotator: No wallpapers loaded, cannot change."); return false; }
         this._currentIndex = (newIndex % this._wallpapers.length + this._wallpapers.length) % this._wallpapers.length;
         // log(`Wallpaper Rotator: Changing wallpaper to index ${this._currentIndex}`); // Less verbose
         return this._setWallpaper(this._wallpapers[this._currentIndex]);
     }
    _changeWallpaperRandom() { /* ... same as before ... */
        if (!this._wallpapers || this._wallpapers.length <= 1) { log(`Wallpaper Rotator: Only ${this._wallpapers ? this._wallpapers.length : 0} wallpaper(s), not changing randomly`); return false; }
        const oldIndex = this._currentIndex; let newIndex = oldIndex;
        while (newIndex === oldIndex) { newIndex = Math.floor(Math.random() * this._wallpapers.length); }
        // log(`Wallpaper Rotator: Randomly selected index: ${newIndex}`); // Less verbose
        this._currentIndex = newIndex; return this._setWallpaper(this._wallpapers[this._currentIndex]);
    }

    // *** MODIFIED: Fix timeout issue ***
    _startRotation() {
        // Remove existing timer *before* any checks or returns
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
            log("Wallpaper Rotator: Removed existing timer before starting new one.");
        }

        if (!this._wallpapers || this._wallpapers.length <= 1) {
            this._updateStatus('Not enough images to rotate');
            this._isRunning = false;
            if(this._rotationSwitch) this._rotationSwitch.setToggleState(false);
            this._updateRotationSwitchLabel();
            return;
        }

        this._isRunning = true;
        const intervalSeconds = Math.max(1, this._interval) * 60;
        log(`Wallpaper Rotator: Starting rotation, interval: ${intervalSeconds}s`);

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT_IDLE,
            intervalSeconds,
            () => { // Arrow function preserves 'this'
                if (!this._isRunning) return GLib.SOURCE_REMOVE;
                // log("Wallpaper Rotator: Timer changing wallpaper"); // Less verbose
                this._changeWallpaperRandom();
                return GLib.SOURCE_CONTINUE; // Reschedule
            }
        );
        this._updateRotationSwitchLabel();
    }

    _stopRotation() { /* ... same as before ... */
        this._isRunning = false;
        if (this._timeout) { GLib.source_remove(this._timeout); this._timeout = null; log("Wallpaper Rotator: Rotation timer stopped"); }
        this._updateRotationSwitchLabel(); this._updateStatus();
    }
    _onPreviousActivated() { this._changeWallpaper(this._currentIndex - 1); }
    _onNextActivated() { this._changeWallpaper(this._currentIndex + 1); }
    _onRandomActivated() { this._changeWallpaperRandom(); }
    _onRefreshActivated() { log(`Wallpaper Rotator: Manually refreshing wallpaper list`); this._loadWallpapers(); }
    _onRotationToggled(item, state) { log(`Wallpaper Rotator: Rotation toggled via switch to ${state}`); if (state) { this._startRotation(); } else { this._stopRotation(); } }
    _onSettingsActivated() { try { ExtensionUtils.openPrefs(); } catch (e) { logError(e, `Wallpaper Rotator: Error opening preferences`); } }
    _onSettingsChanged(settings, key) { /* ... same as before, includes last-action ... */
        // log(`Wallpaper Rotator: Settings changed - ${key}`); // Less verbose
        switch (key) {
            case 'wallpaper-directory': const newDir = this._extensionSettings.get_string('wallpaper-directory'); const effectiveDir = (newDir && newDir !== '') ? newDir : DEFAULT_WALLPAPER_DIR; if (effectiveDir !== this._wallpaperDir) { this._wallpaperDir = effectiveDir; log(`Wallpaper Rotator: Reloading wallpapers due to directory change.`); this._loadWallpapers(); } break;
            case 'interval': const newInterval = this._extensionSettings.get_int('interval'); if (newInterval > 0 && newInterval !== this._interval) { this._interval = newInterval; this._updateRotationSwitchLabel(); if (this._isRunning) { log("Wallpaper Rotator: Restarting rotation timer with new interval."); this._startRotation(); } } else if (newInterval <= 0) { log(`Wallpaper Rotator: Invalid interval ${newInterval} ignored.`); } break;
            case 'last-action': const action = settings.get_string('last-action'); if (action === 'directory-changed') { log(`Wallpaper Rotator: Received directory-changed action`); this._loadWallpapers(); } break;
        }
    }

    destroy() {
        log("Wallpaper Rotator: Destroying...");
        this._stopRotation();

        if (this._extensionSettings && this._settingsChangedId) { this._extensionSettings.disconnect(this._settingsChangedId); this._settingsChangedId = null; }
        this._extensionSettings = null;

        if (this._interfaceSettings && this._colorSchemeMonitorId) { this._interfaceSettings.disconnect(this._colorSchemeMonitorId); this._colorSchemeMonitorId = null; }
        this._interfaceSettings = null;

        this._settings = null; this._wallpapers = []; this._statusLabel = null;

        super.destroy();
        log("Wallpaper Rotator: Destroyed.");
    }
});
// Global functions for extension lifecycle
function init(metadata) { log(`Initializing Wallpaper Rotator extension v${metadata ? metadata.version : 'N/A'}`); }
function enable() { /* ... same as before ... */ log(`Enabling Wallpaper Rotator extension`); try { wallpaperRotator = new WallpaperRotator(); Main.panel.addToStatusArea('wallpaper-rotator', wallpaperRotator, 1); } catch(e) { logError(e, 'Failed to enable Wallpaper Rotator'); if (wallpaperRotator) { try { wallpaperRotator.destroy(); } catch (e2) { logError(e2); } wallpaperRotator = null; } } }
function disable() { /* ... same as before ... */ log(`Disabling Wallpaper Rotator extension`); if (wallpaperRotator) { try { wallpaperRotator.destroy(); } catch(e) { logError(e, 'Error destroying Wallpaper Rotator instance'); } wallpaperRotator = null; } log(`Wallpaper Rotator extension disabled`); }