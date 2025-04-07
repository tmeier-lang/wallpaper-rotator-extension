// extension.js - Wallpaper Rotator Gnome Shell Extension
const { GObject, St, Gio, GLib, Clutter, Pango } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// Minimal logging
function logError(error, message = '') {
    console.error(`WallpaperRotator Error: ${message}`, error);
}

// --- Constants ---
const DEFAULT_INTERVAL = 60; // minutes
const DEFAULT_WALLPAPER_DIR = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
const PREVIEW_WIDTH = 280;
const PREVIEW_HEIGHT = 158; // 16:9 aspect ratio
const ICON_LIGHT = 'icon-light.svg';
const ICON_DARK = 'icon-dark.svg';
const HOVER_REVERT_DELAY_MS = 50; // Delay before preview reverts after hover ends

let wallpaperRotator = null;

const WallpaperRotator = GObject.registerClass(
class WallpaperRotator extends PanelMenu.Button {
    _init() {
        super._init(0.0, "Wallpaper Rotator");

        // Instance variables
        this._wallpaperDir = DEFAULT_WALLPAPER_DIR;
        this._wallpapers = [];
        this._currentIndex = 0;
        this._interval = DEFAULT_INTERVAL;
        this._isRunning = false;
        this._useRandomOrder = true;
        this._desktopSettings = null; // Renamed for clarity
        this._timeout = null;
        this._extensionSettings = null;
        this._interfaceSettings = null;
        this._colorSchemeMonitorId = null;
        this._settingsChangedId = null;
        this._statusLabel = null;
        this._rotationSwitch = null;
        this._randomSwitch = null;
        this._previewContainer = null;
        this._navHovering = false;
        this._icon = null; // Panel icon actor

        // Create panel icon
        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_name: 'image-x-generic-symbolic', // Initial fallback
            icon_size: 16
        });
        this.add_child(this._icon);

        // Load settings
        this._loadSettings();
        this._desktopSettings = new Gio.Settings({ schema: 'org.gnome.desktop.background' });

        // Monitor theme changes for icon
        try {
            this._interfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
            this._colorSchemeMonitorId = this._interfaceSettings.connect(
                'changed::color-scheme', this._updatePanelIcon.bind(this)
            );
        } catch (e) {
            logError(e, "Failed to monitor interface GSettings.");
        }
        this._updatePanelIcon(); // Set initial icon

        // Build the menu UI
        this._createMenu();

        // Load initial wallpapers
        this._loadWallpapers();
    }

    // --- Panel Icon Handling ---

    _updatePanelIcon() {
        let useLight = false;
        try {
            if (this._interfaceSettings) {
                const colorScheme = this._interfaceSettings.get_string('color-scheme');
                useLight = (colorScheme === 'prefer-dark');
            } else if (Main.panel?.get_theme_node()?.get_background_color) { // Optional chaining
                const themeNode = Main.panel.get_theme_node();
                const bgColor = themeNode.get_background_color();
                const luminance = 0.2126 * bgColor.red + 0.7152 * bgColor.green + 0.0722 * bgColor.blue;
                useLight = (luminance < 128);
            }

            const iconFileName = useLight ? ICON_LIGHT : ICON_DARK;
            const iconDir = GLib.build_filenamev([Me.path, 'icons']); // Standard: icons subdir
            const iconPath = GLib.build_filenamev([iconDir, iconFileName]);
            const iconFile = Gio.File.new_for_path(iconPath);

             if (iconFile.query_exists(null)) {
                 this._setGIconFromFile(iconFile);
             } else {
                 // Fallback: Check extension root dir
                 const flatIconPath = GLib.build_filenamev([Me.path, iconFileName]);
                 const flatIconFile = Gio.File.new_for_path(flatIconPath);
                 if (flatIconFile.query_exists(null)) {
                     this._setGIconFromFile(flatIconFile);
                 } else {
                     logError(new Error(`Icon file not found`), `${iconFileName}`);
                     this._setDefaultPanelIcon();
                 }
             }
        } catch (e) {
            logError(e, `Error updating panel icon`);
            this._setDefaultPanelIcon();
        }
    }

    _setGIconFromFile(iconFile) {
         const fileIcon = Gio.FileIcon.new(iconFile);
         if (fileIcon && this._icon) {
             this._icon.icon_name = null;
             this._icon.gicon = fileIcon;
         } else if (this._icon) {
             logError(new Error(`Failed to create FileIcon for ${iconFile.get_path()}`));
             this._setDefaultPanelIcon();
         }
    }

    _setDefaultPanelIcon() {
        if (!this._icon) return;
        this._icon.gicon = null;
        // Prefer image-x-generic, fallback to others
        const fallbackIcons = ['image-x-generic-symbolic', 'preferences-desktop-wallpaper-symbolic', 'folder-pictures-symbolic'];
        const themeContext = St.ThemeContext.get_for_stage(global.stage);

        for (const iconName of fallbackIcons) {
            try {
                if (themeContext.get_icon_theme().has_icon(iconName)) {
                    this._icon.icon_name = iconName;
                    return; // Found a valid fallback
                }
            } catch (e) { /* Ignore */ }
        }
        // Last resort if none found/valid
        try { this._icon.icon_name = 'application-x-executable-symbolic'; }
        catch (e) { logError(e, "Failed to set even last resort fallback icon."); }
    }

    // --- Menu Creation ---

    _createMenu() {
        this.menu.removeAll(); // Clear previous items if any

        // Preview Area
        const previewItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const centerBox = new St.BoxLayout({ vertical: true, x_expand: true, x_align: Clutter.ActorAlign.CENTER });
        this._previewContainer = new St.Bin({
            style_class: 'wallpaper-preview-container',
            width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            clip_to_allocation: true,
            style: 'border-radius: 6px; border: 1px solid rgba(128, 128, 128, 0.2); background-color: rgba(0,0,0,0.1);' // Placeholder style
        });
        centerBox.add_child(this._previewContainer);
        centerBox.add_child(new St.Widget({ height: 8 })); // Spacing
        previewItem.actor.add_child(centerBox);
        this.menu.addMenuItem(previewItem);

        // Status Label
        const statusItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this._statusLabel = new St.Label({ text: 'Loading...', style_class: 'wallpaper-status-label', x_align: Clutter.ActorAlign.CENTER });
        this._statusLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.MIDDLE);
        const labelBox = new St.BoxLayout({ x_expand: true, x_align: Clutter.ActorAlign.CENTER }); // Center label horizontally
        labelBox.add_child(this._statusLabel);
        statusItem.actor.add_child(labelBox);
        this.menu.addMenuItem(statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Control Buttons (Prev/Random/Next)
        const controlsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const controlsBox = new St.BoxLayout({ style_class: 'popup-menu-control-box' }); // Use for potential styling

        const createControlButton = (iconName, accessibleName, callback) => {
            const icon = new St.Icon({ icon_name: iconName, style_class: 'popup-menu-icon' });
            const button = new St.Button({ child: icon, style_class: 'button popup-menu-button', can_focus: true, reactive: true, accessible_name: accessibleName });
            button.connect('clicked', callback);
            return button;
        };

        const prevButton = createControlButton('media-skip-backward-symbolic', 'Previous Wallpaper', this._onPreviousActivated.bind(this));
        const nextButton = createControlButton('media-skip-forward-symbolic', 'Next Wallpaper', this._onNextActivated.bind(this));
        const randomButton = createControlButton('media-seek-forward-symbolic', 'Random Wallpaper', this._onRandomActivated.bind(this)); // Was view-refresh

        // Connect hover signals for preview
        prevButton.connect('notify::hover', this._onNavButtonHover.bind(this, 'prev'));
        nextButton.connect('notify::hover', this._onNavButtonHover.bind(this, 'next'));

        // Layout controls with spacers
        controlsBox.add_child(prevButton);
        controlsBox.add_child(new St.Widget({ x_expand: true }));
        controlsBox.add_child(randomButton);
        controlsBox.add_child(new St.Widget({ x_expand: true }));
        controlsBox.add_child(nextButton);
        controlsItem.actor.add_child(controlsBox);
        this.menu.addMenuItem(controlsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Toggles & Actions
        this._rotationSwitch = new PopupMenu.PopupSwitchMenuItem('', false); // Label set dynamically
        this._rotationSwitch.connect('toggled', this._onRotationToggled.bind(this));
        this.menu.addMenuItem(this._rotationSwitch);

        this._randomSwitch = new PopupMenu.PopupSwitchMenuItem('Use Random Order', this._useRandomOrder);
        this._randomSwitch.connect('toggled', this._onRandomToggled.bind(this));
        this.menu.addMenuItem(this._randomSwitch);

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Wallpaper List');
        refreshItem.connect('activate', this._onRefreshActivated.bind(this));
        this.menu.addMenuItem(refreshItem);

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', this._onSettingsActivated.bind(this));
        this.menu.addMenuItem(settingsItem);

        // Initial UI updates
        this._updateRotationSwitchLabel();
        this._updateStatus();
        this._updatePreview();
    }

    // --- Settings ---

     _loadSettings() {
        try {
            if (!this._extensionSettings) {
                this._extensionSettings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator');
            }
            const dirValue = this._extensionSettings.get_string('wallpaper-directory');
            this._wallpaperDir = (dirValue?.trim()) ? dirValue : DEFAULT_WALLPAPER_DIR; // Use default if empty/null

            this._interval = this._extensionSettings.get_int('interval');
            if (this._interval <= 0) this._interval = DEFAULT_INTERVAL;

            // Check if random-order key exists before reading
            if (this._extensionSettings.settings_schema.has_key('random-order')) {
                 this._useRandomOrder = this._extensionSettings.get_boolean('random-order');
            } else { this._useRandomOrder = true; } // Default if key missing

            // Connect to changes if not already connected
            if (!this._settingsChangedId) {
                this._settingsChangedId = this._extensionSettings.connect('changed', this._onSettingsChanged.bind(this));
            }
        } catch (e) {
            logError(e, `Error loading settings. Using defaults.`);
            this._wallpaperDir = DEFAULT_WALLPAPER_DIR;
            this._interval = DEFAULT_INTERVAL;
            this._useRandomOrder = true;
        } finally {
            // Ensure UI reflects loaded settings (or defaults on error)
            this._updateRotationSwitchLabel(); // Needed as interval might change
            if (this._randomSwitch) this._randomSwitch.setToggleState(this._useRandomOrder);
        }
    }

     _onSettingsChanged(settings, key) {
         // log(`Settings key changed externally: ${key}`); // Keep this for debug if needed
         let needsRotationRestart = false;
        switch (key) {
            case 'wallpaper-directory':
                const newDir = settings.get_string('wallpaper-directory');
                const effectiveDir = (newDir?.trim()) ? newDir : DEFAULT_WALLPAPER_DIR;
                if (effectiveDir !== this._wallpaperDir) {
                    this._wallpaperDir = effectiveDir;
                    this._loadWallpapers(); // Reload wallpapers for new dir
                    needsRotationRestart = this._isRunning;
                }
                break;
            case 'interval':
                const newInterval = settings.get_int('interval');
                if (newInterval > 0 && newInterval !== this._interval) {
                    this._interval = newInterval;
                    this._updateRotationSwitchLabel();
                    needsRotationRestart = this._isRunning;
                } else if (newInterval <= 0) {
                     // Maybe log invalid interval from settings? Optional.
                     // log(`Invalid interval ${newInterval} from settings ignored.`);
                }
                break;
            case 'random-order':
                 if (settings.settings_schema.has_key('random-order')) {
                     try {
                         const newRandom = settings.get_boolean('random-order');
                         if (this._useRandomOrder !== newRandom) {
                             this._useRandomOrder = newRandom;
                             if (this._randomSwitch) this._randomSwitch.setToggleState(newRandom);
                             // No rotation restart needed, checked on next timer fire
                         }
                     } catch (e) { logError(e, "Error reading changed 'random-order' setting."); }
                 }
                break;
        }
         if (needsRotationRestart) {
             // log("Restarting rotation timer due to settings change."); // Optional debug log
             this._startRotation(); // Handles stopping old timer too
         }
    }

    // --- Wallpaper Loading & Handling ---

    _loadWallpapers() {
        this._wallpapers = [];
        this._currentIndex = 0;
        let imageCount = 0;
        let loadError = null;

        try {
            const dir = Gio.File.new_for_path(this._wallpaperDir);
            if (!dir.query_exists(null)) {
                loadError = `Directory not found`; // Status will show full path
            } else {
                const enumerator = dir.enumerate_children(
                    'standard::name,standard::type,standard::is-hidden,standard::content-type', // Get content type
                    Gio.FileQueryInfoFlags.NONE, null
                );
                // Prefer MIME types, fallback to extensions
                const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml'];
                const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
                let info;
                while ((info = enumerator.next_file(null))) {
                    if (info.get_is_hidden()) continue;
                    const name = info.get_name();
                    const contentType = info.get_content_type()?.toLowerCase(); // Use optional chaining and lowercase once
                    const nameLower = name.toLowerCase();

                    const isSupported = (contentType && supportedMimeTypes.includes(contentType)) ||
                                      supportedExtensions.some(ext => nameLower.endsWith(ext));

                    if (isSupported) {
                        this._wallpapers.push(GLib.build_filenamev([this._wallpaperDir, name]));
                        imageCount++;
                    }
                }
                enumerator.close(null);

                if (imageCount > 0) {
                    // Try to find current wallpaper index
                    try {
                        const currentUri = this._desktopSettings.get_string('picture-uri');
                        if (currentUri) {
                            const [success, currentPath] = GLib.filename_from_uri(currentUri, null);
                            if (success && currentPath) {
                                const index = this._wallpapers.indexOf(currentPath);
                                if (index >= 0) this._currentIndex = index;
                                // else: current wallpaper not in list, keep index 0
                            }
                            // else: error converting URI, keep index 0
                        }
                        // else: no current URI set, keep index 0
                    } catch (e) { /* Non-critical error finding index */ }
                } else if (!loadError) {
                    loadError = "No supported images found";
                }
            }
        } catch (e) {
            loadError = `Error reading directory`;
            logError(e, `Failed loading wallpapers from ${this._wallpaperDir}`);
        } finally {
            // log(`Loaded ${imageCount} wallpapers from ${this._wallpaperDir}.`); // Optional summary log
            this._updateStatus(loadError); // Update label based on errors or counts
            this._updatePreview(); // Show preview of current/first image (or placeholder)

            // Stop rotation if running but not enough images now
            if (this._isRunning && imageCount <= 1) {
                this._stopRotation();
            } else {
                // Update switch label in case interval changed or rotation stopped/started implicitly
                this._updateRotationSwitchLabel();
            }
        }
    }

     _setWallpaper(path) {
        try {
            const file = Gio.File.new_for_path(path);
            if (!file.query_exists(null)) {
                logError(new Error(`File not found: ${path}. Removing from list.`));
                 // Remove missing file efficiently
                 const missingIndex = this._wallpapers.indexOf(path);
                 if (missingIndex > -1) {
                     this._wallpapers.splice(missingIndex, 1);
                     // Adjust current index if needed
                     if (this._currentIndex >= this._wallpapers.length) {
                         this._currentIndex = Math.max(0, this._wallpapers.length - 1); // Go to last or 0 if empty
                     } else if (this._currentIndex > missingIndex) {
                         this._currentIndex--;
                     }
                 }
                 this._updateStatus(`Error: Image file missing`);
                 this._updatePreview(); // Update UI
                return false;
            }

            const uri = file.get_uri();
            // Set both light and dark URIs for consistency
            const successUri = this._desktopSettings.set_string('picture-uri', uri);
            const successUriDark = this._desktopSettings.set_string('picture-uri-dark', uri);

             if (!successUri || !successUriDark) {
                 // This usually indicates a permissions issue or maybe invalid URI format?
                 logError(new Error(`GSettings write failed for ${uri}.`));
                 this._updateStatus(`Error setting wallpaper`);
                 return false;
             }

            // Gio.Settings.sync(); // Generally not needed

            // Update UI state
            this._updateStatus();
            this._updatePreview();
            return true;

        } catch (e) {
            logError(e, `Error setting wallpaper to ${path}`);
            this._updateStatus(`Error setting wallpaper`);
            return false;
        }
    }

     _changeWallpaper(newIndex) {
        const count = this._wallpapers.length;
        if (count === 0) return false;
        this._currentIndex = (newIndex % count + count) % count; // Handles negative indices correctly
        return this._setWallpaper(this._wallpapers[this._currentIndex]);
    }

    _changeWallpaperRandom() {
        const count = this._wallpapers.length;
        if (count <= 1) return count === 1; // No change needed/possible, return true if one exists

        let newIndex = this._currentIndex;
        while (newIndex === this._currentIndex) { // Ensure index actually changes
            newIndex = Math.floor(Math.random() * count);
        }
        this._currentIndex = newIndex;
        return this._setWallpaper(this._wallpapers[this._currentIndex]);
    }

    // --- UI Updates (Status, Preview) ---

     _updateStatus(message = null) {
        if (!this._statusLabel) return;
        if (message) {
            // Show specific error or loading message
            this._statusLabel.text = message === 'Directory not found' ? `${message}: ${this._wallpaperDir}` : message;
        } else {
            // Show standard count/index message
            const count = this._wallpapers.length;
            if (count === 0) {
                this._statusLabel.text = 'No supported images found'; // Default if dir exists but is empty
                // Re-check dir existence here only if needed for more specific message, adds overhead
            } else if (count === 1) {
                this._statusLabel.text = `1 Wallpaper found`;
            } else {
                const displayIndex = (this._currentIndex >= 0 && this._currentIndex < count) ? this._currentIndex + 1 : '?';
                this._statusLabel.text = `Wallpaper ${displayIndex} of ${count}`;
            }
        }
    }

    _updatePreview() {
        // Update preview to show the currently selected wallpaper
        this._updatePreviewToIndex(this._currentIndex);
    }

    _updatePreviewToIndex(index) {
        // Update preview to show wallpaper at a specific index (used for current and hover)
        if (!this._previewContainer) return;

        const baseStyle = 'border-radius: 6px; border: 1px solid rgba(128, 128, 128, 0.2);';
        const placeholderStyle = `${baseStyle} background-color: rgba(0,0,0,0.1); background-image: none;`;
        const count = this._wallpapers.length;

        if (count === 0 || index < 0 || index >= count) {
            this._previewContainer.style = placeholderStyle;
            return;
        }

        try {
            const wallpaperPath = this._wallpapers[index];
            const file = Gio.File.new_for_path(wallpaperPath);

            if (!file.query_exists(null)) {
                this._previewContainer.style = placeholderStyle;
                // Consider triggering a reload or showing error if current file vanished
                 if (index === this._currentIndex) {
                     logError(new Error(`Current wallpaper file missing: ${wallpaperPath}. Reloading.`));
                     GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { this._loadWallpapers(); return GLib.SOURCE_REMOVE; });
                 }
                return;
            }

            const uri = file.get_uri();
            if (!uri) throw new Error("Could not get URI");

            // Basic CSS escaping for url('...')
            const escapedUri = uri.replace(/['"()]/g, c => ({ "'": "\\'", '"': '\\"', '(': "\\(", ')': "\\)" }[c]));

            this._previewContainer.style = `
                ${baseStyle}
                background-image: url('${escapedUri}');
                background-size: cover;
                background-position: center center;
                background-repeat: no-repeat;
            `;
        } catch (e) {
            logError(e, `Failed to update preview for index ${index}`);
            this._previewContainer.style = placeholderStyle; // Revert on error
        }
    }

     _onNavButtonHover(direction, button) {
        // Show preview of next/prev wallpaper on hover
        const count = this._wallpapers.length;
        if (count <= 1) return; // No effect needed

        if (button.get_hover()) {
            this._navHovering = true;
            const targetIndex = (direction === 'next')
                ? (this._currentIndex + 1) % count
                : (this._currentIndex - 1 + count) % count;
            this._updatePreviewToIndex(targetIndex);
        } else {
             this._navHovering = false;
             // Delay reverting the preview slightly - feels less jarring
             GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, HOVER_REVERT_DELAY_MS, () => {
                 // Only revert if hover hasn't moved to the *other* nav button meanwhile
                 if (!this._navHovering) {
                     this._updatePreview(); // Revert to current index
                 }
                 return GLib.SOURCE_REMOVE; // Timer runs only once
             });
        }
    }

     _updateRotationSwitchLabel() {
        if (!this._rotationSwitch) return;
        const intervalText = (this._interval > 0) ? `${this._interval} min` : 'N/A';
        const stateText = this._isRunning ? `Every ${intervalText}` : `Interval: ${intervalText}`;
        this._rotationSwitch.label.text = `Auto-Rotate (${stateText})`;
        // Sync visual toggle state with internal state
        if (this._rotationSwitch.state !== this._isRunning) {
            this._rotationSwitch.setToggleState(this._isRunning);
        }
    }

    // --- Rotation Timer ---

     _startRotation() {
        this._stopRotation(); // Clear existing timer first

        const count = this._wallpapers.length;
        if (count <= 1) {
            this._isRunning = false; // Can't rotate
            this._updateRotationSwitchLabel();
            this._updateStatus(count === 0 ? 'No images to rotate' : 'Need >1 image to rotate');
            return;
        }

        if (this._interval <= 0) this._interval = DEFAULT_INTERVAL; // Safety check

        this._isRunning = true;
        const intervalSeconds = this._interval * 60;
        // log(`Starting rotation: ${intervalSeconds}s interval, random: ${this._useRandomOrder}`); // Optional debug

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT_IDLE, intervalSeconds,
            () => {
                if (!this._isRunning) { this._timeout = null; return GLib.SOURCE_REMOVE; } // Stop if disabled meanwhile
                if (this._useRandomOrder) this._changeWallpaperRandom();
                else this._changeWallpaper(this._currentIndex + 1);
                return GLib.SOURCE_CONTINUE; // Reschedule timer
            }
        );
        this._updateRotationSwitchLabel();
        this._updateStatus();
    }

    _stopRotation() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._isRunning) { // Only update state/UI if it was running
            this._isRunning = false;
            this._updateRotationSwitchLabel();
            this._updateStatus(); // Update status which might depend on running state indirectly
        }
    }

    // --- Menu Item Activation Callbacks ---

    _onPreviousActivated() { this._changeWallpaper(this._currentIndex - 1); }
    _onNextActivated() { this._changeWallpaper(this._currentIndex + 1); }
    _onRandomActivated() { this._changeWallpaperRandom(); }
    _onRefreshActivated() {
        this._loadWallpapers();
        if (this._isRunning) this._startRotation(); // Restart timer with potentially new list/count
    }
    _onRotationToggled(item, state) {
        // state is the new desired state from the switch
        if (state) this._startRotation();
        else this._stopRotation();
        // Ensure internal state and UI match, even if start fails (e.g. <=1 image)
        this._isRunning = state && (this._wallpapers.length > 1);
        this._updateRotationSwitchLabel();
    }
    _onRandomToggled(item, state) {
        if (this._useRandomOrder === state) return; // No change
        this._useRandomOrder = state;
        // Attempt to save the setting
        try {
            if (this._extensionSettings?.settings_schema.has_key('random-order')) { // Optional chaining
                this._extensionSettings.set_boolean('random-order', state);
            }
        } catch (e) { logError(e, `Could not save random-order setting`); }
    }
    _onSettingsActivated() {
        try { ExtensionUtils.openPrefs(); }
        catch (e) { logError(e, `Error opening preferences.`); Main.notifyError("Wallpaper Rotator", "Could not open settings dialog."); }
    }

    // --- Destruction ---

    destroy() {
        this._stopRotation(); // Stop timer

        // Disconnect signal handlers safely
        if (this._extensionSettings && this._settingsChangedId) { try { this._extensionSettings.disconnect(this._settingsChangedId); } catch(e) {} }
        if (this._interfaceSettings && this._colorSchemeMonitorId) { try { this._interfaceSettings.disconnect(this._colorSchemeMonitorId); } catch(e) {} }

        // Nullify references to release resources
        this._wallpapers = [];
        this._extensionSettings = null;
        this._interfaceSettings = null;
        this._desktopSettings = null;
        this._statusLabel = null;
        this._previewContainer = null;
        this._rotationSwitch = null;
        this._randomSwitch = null;
        this._icon = null;
        this._settingsChangedId = null;
        this._colorSchemeMonitorId = null;
        this._currentIndex = -1;

        // Call parent destroy method - this should handle removing the menu from the panel
        super.destroy();
    }
});

// --- Global Extension Lifecycle Functions ---

function init(metadata) {
    // Optional: Setup translations here if needed
    // ExtensionUtils.initTranslations();
}

function enable() {
    try {
        if (wallpaperRotator) { // Destroy lingering instance if enable is called again unexpectedly
            logError(new Error("Instance already exists during enable?"), "Destroying previous.");
            wallpaperRotator.destroy();
        }
        wallpaperRotator = new WallpaperRotator();
        Main.panel.addToStatusArea('wallpaper-rotator', wallpaperRotator, 1, 'right'); // Add to right side
        console.log("WallpaperRotator enabled."); // Use console.log for enable/disable
    } catch(e) {
        logError(e, 'Failed to enable Wallpaper Rotator');
        if (wallpaperRotator) { try { wallpaperRotator.destroy(); } catch (e2) {} } // Cleanup attempt
        wallpaperRotator = null;
    }
}

function disable() {
    if (wallpaperRotator) {
        try { wallpaperRotator.destroy(); }
        catch(e) { logError(e, 'Error destroying instance during disable.'); }
        finally { wallpaperRotator = null; } // Ensure it's cleared
    }
    console.log("WallpaperRotator disabled."); // Use console.log for enable/disable
}