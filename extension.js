// extension.js - Main extension file
const { GObject, St, Gio, GLib, Clutter, Pango } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// Logging function for convenience
function log(message) {
    console.log(`WallpaperRotator: ${message}`);
}
function logError(error, message = '') {
    console.error(`WallpaperRotator Error: ${message}`, error);
}


// Default configuration
const DEFAULT_INTERVAL = 60; // minutes
const DEFAULT_WALLPAPER_DIR = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
const PREVIEW_WIDTH = 280;
const PREVIEW_HEIGHT = 158; // 16:9 aspect ratio

// Icon Filenames
const ICON_LIGHT = 'icon-light.svg';
const ICON_DARK = 'icon-dark.svg';

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
        this._useRandomOrder = true; // Added random order variable, default to true
        this._settings = null;
        this._lastChangeTime = 0;
        this._timeout = null;
        this._extensionSettings = null;
        this._interfaceSettings = null;
        this._colorSchemeMonitorId = null;
        this._settingsChangedId = null;
        this._statusLabel = null;
        this._rotationSwitch = null;
        this._randomSwitch = null; // Added switch for random order toggle
        this._previewContainer = null; // Container will now display the background
        // this._previewImage = null; // No longer using St.Icon for preview

        // Create icon with system icon initially (fallback)
        this._icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_name: 'image-x-generic-symbolic',
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
            this._colorSchemeMonitorId = this._interfaceSettings.connect(
                'changed::color-scheme',
                this._updatePanelIcon.bind(this)
            );
            this._updatePanelIcon();
        } catch (e) {
            logError(e, "Failed to monitor interface settings. Using default icon.");
            // Ensure icon is still attempted to be set even if monitoring fails
             this._updatePanelIcon();
        }

        // Create menu items
        this._createMenu();

        // Load wallpapers
        this._loadWallpapers();
    }

    _updatePanelIcon() {
        let useLight = false;
        try {
            // Check GSettings first (more reliable)
            if (this._interfaceSettings && this._interfaceSettings.get_string) {
                const colorScheme = this._interfaceSettings.get_string('color-scheme');
                // Values are 'default', 'prefer-dark', 'prefer-light'
                useLight = (colorScheme === 'prefer-dark');
                log(`Color scheme detected via GSettings: ${colorScheme}, using light icon: ${useLight}`);
            }
            // Fallback: Check panel theme node background color (less reliable)
            else if (Main.panel && Main.panel.get_theme_node && Main.panel.get_theme_node().get_background_color) {
                const themeNode = Main.panel.get_theme_node();
                const backgroundColor = themeNode.get_background_color();
                // Simple luminance check (adjust threshold if needed)
                const luminance = 0.2126 * backgroundColor.red + 0.7152 * backgroundColor.green + 0.0722 * backgroundColor.blue; // Standard luminance formula
                useLight = (luminance < 128); // Threshold for dark background
                 log(`Color scheme detected via panel luminance: ${luminance}, using light icon: ${useLight}`);
            } else {
                 log("Could not determine color scheme, defaulting to dark icon.");
            }

            const iconFileName = useLight ? ICON_LIGHT : ICON_DARK;
            if (!Me || !Me.path) {
                logError(new Error("Extension path not available"));
                this._setDefaultPanelIcon();
                return;
            }
            const iconPath = GLib.build_filenamev([Me.path, 'icons', iconFileName]); // Assume icons are in an 'icons' subdirectory
            const iconFile = Gio.File.new_for_path(iconPath);

            if (!iconFile.query_exists(null)) {
                logError(new Error(`Icon file not found: ${iconPath}`));
                this._setDefaultPanelIcon();
                return;
            }

            const fileIcon = Gio.FileIcon.new(iconFile);
            if (!fileIcon) {
                logError(new Error(`Failed to create FileIcon for ${iconPath}`));
                this._setDefaultPanelIcon();
                return;
            }

            // Set the GIcon
            this._icon.icon_name = null; // Clear symbolic icon name if any
            this._icon.gicon = fileIcon;
            log(`Set panel icon to ${iconFileName}`);

        } catch (e) {
            logError(e, `Error updating panel icon`);
            this._setDefaultPanelIcon();
        }
    }


    _setDefaultPanelIcon() {
        if (this._icon) {
            this._icon.gicon = null; // Clear any previous gicon
            const fallbackIcons = ['image-x-generic-symbolic', 'preferences-desktop-wallpaper-symbolic', 'document-new-symbolic', 'folder-pictures-symbolic'];
            for (const iconName of fallbackIcons) {
                try {
                    // Test if the icon name is valid before setting it
                     const themeContext = St.ThemeContext.get_for_stage(global.stage);
                     const iconInfo = themeContext.get_icon_theme().lookup_icon(iconName, this._icon.icon_size || 16, 0);
                     if (iconInfo) {
                        this._icon.icon_name = iconName;
                        log(`Using fallback icon ${iconName}`);
                        return; // Success
                     }
                } catch (e) {
                    // Ignore errors trying specific fallbacks
                    log(`Fallback icon ${iconName} failed or not found.`);
                }
            }
            // Last resort if no others worked
            try {
                this._icon.icon_name = 'application-x-executable-symbolic';
                log("Using last resort fallback icon 'application-x-executable-symbolic'");
            }
            catch(e) {
                logError(e, "Failed to set even last resort fallback icon.");
            }
        } else {
            logError(new Error("Cannot set fallback icon, icon widget is null"));
        }
    }

    _createMenu() {
        this.menu.removeAll();

        // --- Wallpaper Preview ---
        const previewItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this.menu.addMenuItem(previewItem);

        // Create a box to center the preview container
        const centerBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER
        });
        previewItem.actor.add_child(centerBox);

        // Container for the preview with clipping.
        // We will set the background image on this container.
        this._previewContainer = new St.Bin({
            style_class: 'wallpaper-preview-container',
            width: PREVIEW_WIDTH,
            height: PREVIEW_HEIGHT,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            clip_to_allocation: true,
             // Initial style, background will be added in _updatePreview
            style: 'border-radius: 6px; border: 1px solid rgba(128, 128, 128, 0.2); background-color: rgba(0,0,0,0.1);'
        });
        centerBox.add_child(this._previewContainer);

        // REMOVED: St.Icon for preview - we use the container's background now.
        // this._previewImage = new St.Icon({ ... });
        // this._previewContainer.set_child(this._previewImage);

        // Add spacing after preview
        const spacing = new St.Widget({ height: 8 });
        centerBox.add_child(spacing);

        // --- Status label (below preview) ---
        const statusItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this.menu.addMenuItem(statusItem);

        this._statusLabel = new St.Label({
            text: 'Loading...',
            style_class: 'wallpaper-status-label',
            x_align: Clutter.ActorAlign.CENTER, // Center label text
        });
        // Allow label to shrink and ellipsize in the middle if needed
        this._statusLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.MIDDLE);

        // Use a Box to ensure the label itself is centered within the menu item
        const labelBox = new St.BoxLayout({
            vertical: false, // Horizontal layout
            x_expand: true, // Take full width
            x_align: Clutter.ActorAlign.CENTER // Center children (the label)
        });
        labelBox.add_child(this._statusLabel);
        statusItem.actor.add_child(labelBox); // Add the box to the menu item


        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Direct Controls Row ---
        const controlsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this.menu.addMenuItem(controlsItem);
        const controlsBox = new St.BoxLayout({ style_class: 'popup-menu-control-box' }); // Add style class if needed
        controlsItem.actor.add_child(controlsBox);

        const createControlButton = (iconName, accessibleName, callback) => {
            const icon = new St.Icon({ icon_name: iconName, style_class: 'popup-menu-icon' });
            const button = new St.Button({
                child: icon,
                style_class: 'button popup-menu-button', // Use standard button style + custom
                can_focus: true,
                reactive: true,
                accessible_name: accessibleName
            });
            button.connect('clicked', callback);
            // Add hover effect? button.connect('notify::hover', ...);
            return button;
        };

        const prevButton = createControlButton('media-skip-backward-symbolic', 'Previous Wallpaper', this._onPreviousActivated.bind(this));
        const nextButton = createControlButton('media-skip-forward-symbolic', 'Next Wallpaper', this._onNextActivated.bind(this));
        const randomButton = createControlButton('media-seek-forward-symbolic', 'Random Wallpaper', this._onRandomActivated.bind(this)); // Changed icon for variety

        // Layout: Prev | Spacer | Random | Spacer | Next
        controlsBox.add_child(prevButton);
        controlsBox.add_child(new St.Widget({ x_expand: true })); // Spacer
        controlsBox.add_child(randomButton);
        controlsBox.add_child(new St.Widget({ x_expand: true })); // Spacer
        controlsBox.add_child(nextButton);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Settings & Toggles ---

        // Auto-rotation toggle
        this._rotationSwitch = new PopupMenu.PopupSwitchMenuItem('', false); // Label set in _updateRotationSwitchLabel
        this._rotationSwitch.connect('toggled', this._onRotationToggled.bind(this));
        this.menu.addMenuItem(this._rotationSwitch);
        this._updateRotationSwitchLabel(); // Set initial label

        // Random order toggle
        this._randomSwitch = new PopupMenu.PopupSwitchMenuItem('Use Random Order', this._useRandomOrder);
        this._randomSwitch.connect('toggled', this._onRandomToggled.bind(this));
        this.menu.addMenuItem(this._randomSwitch);

        // Refresh wallpapers item
        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Wallpaper List');
        refreshItem.connect('activate', this._onRefreshActivated.bind(this));
        this.menu.addMenuItem(refreshItem);

        // Settings button
        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', this._onSettingsActivated.bind(this));
        this.menu.addMenuItem(settingsItem);

        // Update status and preview initially
        this._updateStatus();
        this._updatePreview(); // Call preview update after menu is built
    }


    _updateRotationSwitchLabel() {
        if (this._rotationSwitch && this._rotationSwitch.label) {
            const intervalText = (this._interval > 0) ? `${this._interval} min` : 'N/A';
            const stateText = this._isRunning ? `Every ${intervalText}` : `Interval: ${intervalText}`;
            this._rotationSwitch.label.text = `Auto-Rotate (${stateText})`;
            this._rotationSwitch.setToggleState(this._isRunning); // Ensure switch state matches _isRunning
        }
    }


     _loadSettings() {
        try {
            if (!this._extensionSettings) {
                this._extensionSettings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator');
            }
            // Wallpaper Directory
            const dirValue = this._extensionSettings.get_string('wallpaper-directory');
            this._wallpaperDir = (dirValue && dirValue.trim() !== '') ? dirValue : DEFAULT_WALLPAPER_DIR;
            log(`Loaded wallpaper directory: ${this._wallpaperDir}`);

            // Interval
            this._interval = this._extensionSettings.get_int('interval');
            if (this._interval <= 0) {
                 log(`Loaded interval ${this._interval} is invalid, using default ${DEFAULT_INTERVAL}.`);
                this._interval = DEFAULT_INTERVAL;
                 // Optionally, write the default back to settings if it was invalid
                 // this._extensionSettings.set_int('interval', DEFAULT_INTERVAL);
            } else {
                log(`Loaded interval: ${this._interval} minutes`);
            }

            // Random Order (Check if schema contains the key)
            if (this._extensionSettings.settings_schema.has_key('random-order')) {
                 try {
                     this._useRandomOrder = this._extensionSettings.get_boolean('random-order');
                     log(`Loaded random order: ${this._useRandomOrder}`);
                 } catch (e) {
                     logError(e, "Error reading 'random-order' setting, defaulting to true.");
                     this._useRandomOrder = true;
                 }
            } else {
                 log("'random-order' key not found in schema, defaulting to true.");
                 this._useRandomOrder = true;
            }


            // Connect to settings changes if not already connected
            if (!this._settingsChangedId) {
                this._settingsChangedId = this._extensionSettings.connect('changed', this._onSettingsChanged.bind(this));
                log("Connected to settings changes.");
            }

        } catch (e) {
            logError(e, `Error loading settings. Using defaults.`);
            // Apply defaults explicitly on error
            this._wallpaperDir = DEFAULT_WALLPAPER_DIR;
            this._interval = DEFAULT_INTERVAL;
            this._useRandomOrder = true; // Default random order
        } finally {
             // Update UI elements that depend on settings
             this._updateRotationSwitchLabel();
             if (this._randomSwitch) {
                 this._randomSwitch.setToggleState(this._useRandomOrder);
             }
        }
    }


    _loadWallpapers() {
        this._wallpapers = [];
        this._currentIndex = 0; // Reset index
        let loadError = null;
        let fileCount = 0; // Count all files iterated
        let imageCount = 0; // Count supported images found

        try {
            const dir = Gio.File.new_for_path(this._wallpaperDir);
            if (!dir.query_exists(null)) {
                loadError = `Directory not found: ${this._wallpaperDir}`;
                 logError(new Error(loadError));
            } else {
                log(`Enumerating files in: ${this._wallpaperDir}`);
                const enumerator = dir.enumerate_children(
                    'standard::name,standard::type,standard::is-hidden,standard::content-type', // Request content-type
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );

                // More robust check using content types + extensions as fallback
                const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml'];
                 const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']; // Keep extensions as fallback

                let info;
                while ((info = enumerator.next_file(null))) {
                    fileCount++;
                    if (info.get_is_hidden()) continue; // Skip hidden files

                    const name = info.get_name();
                    const contentType = info.get_content_type();
                     let isSupported = false;

                    // Primary check: MIME type
                    if (contentType && supportedMimeTypes.includes(contentType.toLowerCase())) {
                        isSupported = true;
                    }
                    // Fallback check: Extension (for cases where MIME type might be missing/wrong)
                    else if (!contentType && supportedExtensions.some(ext => name.toLowerCase().endsWith(ext))) {
                        isSupported = true;
                         log(`File "${name}" has no content type, using extension match.`);
                    }
                    // Log unsupported files if needed for debugging:
                    // else {
                    //     log(`Skipping unsupported file: "${name}" (Type: ${contentType || 'N/A'})`);
                    // }


                    if (isSupported) {
                        const filePath = GLib.build_filenamev([this._wallpaperDir, name]);
                        this._wallpapers.push(filePath);
                        imageCount++;
                    }
                }
                enumerator.close(null); // Important to close the enumerator
                log(`Enumerated ${fileCount} items. Found ${imageCount} supported wallpapers.`);

                if (imageCount > 0) {
                    // Try to find the index of the currently set wallpaper
                    try {
                        const currentWallpaperUri = this._settings.get_string('picture-uri');
                        // picture-uri-dark is also relevant but picture-uri is the primary
                        if (currentWallpaperUri && GLib.uri_is_valid(currentWallpaperUri, GLib.UriFlags.NONE)) {
                            const [success, currentPath] = GLib.filename_from_uri(currentWallpaperUri, null);
                            if (success && currentPath) {
                                const index = this._wallpapers.indexOf(currentPath);
                                if (index >= 0) {
                                    this._currentIndex = index;
                                    log(`Current wallpaper "${currentPath}" found at index ${this._currentIndex}.`);
                                } else {
                                    log(`Current wallpaper "${currentPath}" not found in the loaded list. Starting from index 0.`);
                                    this._currentIndex = 0; // Default to first if not found
                                }
                            } else {
                                 log(`Could not get filename from current URI: ${currentWallpaperUri}. Starting from index 0.`);
                                 this._currentIndex = 0;
                            }
                        } else {
                             log("No current wallpaper URI set or URI is invalid. Starting from index 0.");
                            this._currentIndex = 0;
                        }
                    } catch (e) {
                        logError(e, "Non-critical error finding current wallpaper index. Starting from index 0.");
                        this._currentIndex = 0; // Default to first on error
                    }
                } else {
                    this._currentIndex = 0; // No wallpapers, index must be 0
                     if (!loadError) { // Don't overwrite directory not found error
                         loadError = "No supported images found";
                     }
                }
            }
        } catch (e) {
            loadError = `Error reading directory: ${e.message}`;
            logError(e, `Error loading wallpapers from ${this._wallpaperDir}`);
        } finally {
            this._updateStatus(loadError);
            this._updatePreview(); // Update preview after loading

            // If rotation was running but now there aren't enough wallpapers, stop it.
            if (this._isRunning && imageCount <= 1) {
                 log("Stopping rotation because there are not enough wallpapers.");
                this._stopRotation();
            } else {
                // Ensure the rotation switch label is up-to-date even if rotation wasn't stopped
                 this._updateRotationSwitchLabel();
            }
        }
    }


     _updateStatus(message = null) {
        if (!this._statusLabel) {
             logError(new Error("Status label is not available."));
            return;
        }

        if (message) {
            // Display provided error or custom message
            this._statusLabel.text = message;
            log(`Status updated (message): ${message}`);
            return;
        }

        const count = this._wallpapers ? this._wallpapers.length : 0;

        if (count === 0) {
            // Check if the directory exists to provide a more specific message
            try {
                const dir = Gio.File.new_for_path(this._wallpaperDir);
                this._statusLabel.text = dir.query_exists(null) ? 'No supported images found' : 'Directory not found';
            } catch (e) {
                this._statusLabel.text = 'Error accessing directory';
                logError(e, `Error checking directory existence for status update: ${this._wallpaperDir}`);
            }
        } else if (count === 1) {
             this._statusLabel.text = `1 Wallpaper found`;
        }
         else {
            // Ensure currentIndex is valid before displaying
             const displayIndex = (this._currentIndex >= 0 && this._currentIndex < count) ? this._currentIndex + 1 : '?';
            this._statusLabel.text = `Wallpaper ${displayIndex} of ${count}`;
        }
         log(`Status updated: ${this._statusLabel.text}`);
    }


    _updatePreview() {
        // Use the _previewContainer directly for background image
        if (!this._previewContainer) {
             logError(new Error("Preview container is not available for update."));
            return;
        }

        const baseStyle = 'border-radius: 6px; border: 1px solid rgba(128, 128, 128, 0.2);';
         const placeholderStyle = `${baseStyle} background-color: rgba(0,0,0,0.1);`; // Simple placeholder


        if (!this._wallpapers || this._wallpapers.length === 0 || this._currentIndex < 0 || this._currentIndex >= this._wallpapers.length) {
            // No valid wallpaper to show, clear background or set placeholder
            this._previewContainer.style = placeholderStyle + ` background-image: none;`; // Explicitly remove image
            log("Updating preview: No valid wallpaper, showing placeholder.");
            return;
        }

        try {
            const currentWallpaperPath = this._wallpapers[this._currentIndex];
            const file = Gio.File.new_for_path(currentWallpaperPath);

            if (!file.query_exists(null)) {
                // File doesn't exist (might have been deleted)
                this._previewContainer.style = placeholderStyle + ` background-image: none;`;
                logError(new Error(`Preview file not found: ${currentWallpaperPath}`));
                 // Maybe trigger a reload or show a specific error? For now, just show placeholder.
                // this._loadWallpapers(); // Option: Reload if file is missing
                 this._updateStatus("Error: Current image file missing"); // Update status too
                return;
            }

            const uri = file.get_uri();
            if (!uri) {
                this._previewContainer.style = placeholderStyle + ` background-image: none;`;
                logError(new Error(`Could not get URI for file: ${currentWallpaperPath}`));
                return;
            }

            // Set the background using CSS
            // Escape the URI for CSS: basic escaping for spaces, parens, quotes
            const escapedUri = uri.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\(/g, "\\(").replace(/\)/g, "\\)");

            this._previewContainer.style = `
                ${baseStyle}
                background-image: url('${escapedUri}');
                background-size: cover;
                background-position: center center;
                background-repeat: no-repeat;
            `;
            // log(`Updating preview to: ${currentWallpaperPath}`); // Can be verbose

        } catch (e) {
            logError(e, `Failed to update wallpaper preview for index ${this._currentIndex}`);
            this._previewContainer.style = placeholderStyle + ` background-image: none;`; // Fallback on error
        }
    }


    _setWallpaper(path) {
         log(`Attempting to set wallpaper: ${path}`);
        try {
            const file = Gio.File.new_for_path(path);
            if (!file.query_exists(null)) {
                logError(new Error(`File not found: ${path}. Removing from list.`));
                // Remove the missing file and update state
                 const missingIndex = this._wallpapers.indexOf(path);
                 if (missingIndex > -1) {
                     this._wallpapers.splice(missingIndex, 1);
                     // Adjust current index if needed
                     if (this._currentIndex >= this._wallpapers.length) {
                         this._currentIndex = this._wallpapers.length > 0 ? 0 : -1; // Go to start or -1 if empty
                     } else if (this._currentIndex > missingIndex) {
                         this._currentIndex--; // Adjust if removed item was before current
                     }
                     log(`Removed missing file. New count: ${this._wallpapers.length}, current index: ${this._currentIndex}`);
                 }
                 this._updateStatus(`Error: Image file not found`);
                 this._updatePreview(); // Update preview to reflect removal/change
                return false; // Indicate failure
            }

            const uri = file.get_uri();
             log(`Setting picture-uri and picture-uri-dark to: ${uri}`);

            // Set both light and dark URIs to the same image
             // Use GSettings.set_string which returns true/false on success/failure
            let successUri = this._settings.set_string('picture-uri', uri);
            let successUriDark = this._settings.set_string('picture-uri-dark', uri);

             if (!successUri || !successUriDark) {
                 // This usually indicates a permissions issue or invalid schema path
                 logError(new Error(`Failed to set GSettings key(s) for ${uri}. Check permissions/schema.`));
                 this._updateStatus(`Error setting wallpaper (GSettings)`);
                 return false;
             }

             Gio.Settings.sync(); // Try to force immediate application (may not be necessary)

            this._lastChangeTime = GLib.get_monotonic_time() / 1000000; // Record time in seconds
            log(`Wallpaper set successfully at time ${this._lastChangeTime}`);
            this._updateStatus(); // Update "Wallpaper X of Y"
            this._updatePreview(); // Update the preview image
            return true; // Indicate success

        } catch (e) {
            logError(e, `Error setting wallpaper to ${path}`);
            this._updateStatus(`Error setting wallpaper`);
            return false; // Indicate failure
        }
    }


     _changeWallpaper(newIndex) {
        const count = this._wallpapers ? this._wallpapers.length : 0;
        if (count === 0) {
            log("No wallpapers loaded, cannot change.");
            this._updateStatus("No wallpapers to change");
            return false;
        }

        // Wrap index correctly (handles negative numbers too)
        this._currentIndex = (newIndex % count + count) % count;
         log(`Changing wallpaper to index: ${this._currentIndex}`);

        return this._setWallpaper(this._wallpapers[this._currentIndex]);
    }


    _changeWallpaperRandom() {
         const count = this._wallpapers ? this._wallpapers.length : 0;
        if (count <= 1) {
            log(`Only ${count} wallpaper(s), cannot change randomly. Setting current if needed.`);
            // If there's exactly one, ensure it's set
            if (count === 1 && this._currentIndex !== 0) {
                 this._currentIndex = 0;
                 return this._setWallpaper(this._wallpapers[0]);
            } else if (count === 1) {
                 // Already showing the only one, maybe refresh preview/status
                 this._updateStatus();
                 this._updatePreview();
                 return true; // Considered success as the correct wallpaper is shown
            }
            this._updateStatus(count === 0 ? "No wallpapers" : "Only 1 wallpaper");
            return false; // Cannot change *randomly*
        }

        const oldIndex = this._currentIndex;
        let newIndex = oldIndex;

        // Ensure the new index is different from the old one
        while (newIndex === oldIndex) {
            newIndex = Math.floor(Math.random() * count);
        }

        this._currentIndex = newIndex;
        log(`Changing wallpaper randomly to index: ${this._currentIndex}`);
        return this._setWallpaper(this._wallpapers[this._currentIndex]);
    }


     _startRotation() {
        // Stop existing timer first, if any
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
            log("Removed existing timer before starting new one.");
        }

        const count = this._wallpapers ? this._wallpapers.length : 0;
        if (count <= 1) {
            log(`Not starting rotation: Only ${count} wallpaper(s) available.`);
            this._updateStatus(count === 0 ? 'No images to rotate' : 'Need >1 image to rotate');
            this._isRunning = false; // Explicitly set state
             this._updateRotationSwitchLabel(); // Update switch label/state
            return; // Do not start timer
        }

        // Validate interval
         if (this._interval <= 0) {
             logError(new Error(`Invalid interval ${this._interval}. Using default ${DEFAULT_INTERVAL}.`));
             this._interval = DEFAULT_INTERVAL;
         }


        this._isRunning = true;
        const intervalSeconds = this._interval * 60;
        log(`Starting rotation. Interval: ${this._interval} min (${intervalSeconds}s), Random: ${this._useRandomOrder}`);

        // Schedule the *first* change immediately if desired? No, let's wait for the first interval.
        // Or schedule based on _lastChangeTime? Could be complex. Keep it simple: first change after interval.

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT_IDLE, // Lower priority
            intervalSeconds,
            () => {
                if (!this._isRunning) {
                     log("Rotation callback triggered, but rotation is stopped. Removing timer.");
                    this._timeout = null; // Ensure reference is cleared
                    return GLib.SOURCE_REMOVE; // Stop timer
                }

                log(`Timer fired. Changing wallpaper (Random: ${this._useRandomOrder})`);
                if (this._useRandomOrder) {
                    this._changeWallpaperRandom();
                } else {
                    this._changeWallpaper(this._currentIndex + 1);
                }

                // Reschedule the timer
                return GLib.SOURCE_CONTINUE; // Keep timer running
            }
        );

        log(`Rotation timer scheduled with ID: ${this._timeout}`);
        this._updateRotationSwitchLabel(); // Update switch label/state
        this._updateStatus(); // Update status (might just be "Wallpaper X of Y")
    }


    _stopRotation() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null; // Clear the ID
            log("Rotation timer stopped and removed.");
        } else {
            log("Stop rotation requested, but no active timer found.");
        }
        this._isRunning = false; // Update state regardless
        this._updateRotationSwitchLabel(); // Update switch label/state
        this._updateStatus(); // Update status message if needed
    }


    // --- Action Handlers ---

    _onPreviousActivated() {
        log("Previous button clicked.");
        if (this._changeWallpaper(this._currentIndex - 1)) {
             // Optionally reset timer if rotation is active? Debatable.
             // if (this._isRunning) this._startRotation();
        }
    }

    _onNextActivated() {
        log("Next button clicked.");
        if (this._changeWallpaper(this._currentIndex + 1)) {
            // Optionally reset timer
            // if (this._isRunning) this._startRotation();
        }
    }

    _onRandomActivated() {
        log("Random button clicked.");
        if (this._changeWallpaperRandom()) {
            // Optionally reset timer
            // if (this._isRunning) this._startRotation();
        }
    }

    _onRefreshActivated() {
        log("Refresh button clicked. Reloading wallpapers.");
        this._loadWallpapers();
         // If rotation is on, restart it to ensure it uses the potentially new list/count
         if (this._isRunning) {
             log("Restarting rotation after refresh.");
             this._startRotation();
         }
    }

    _onRotationToggled(item, state) {
        // The 'state' parameter directly from the switch reflects the new desired state
        log(`Rotation switch toggled to: ${state}`);
        if (state) {
             // User wants to start rotation
             if (!this._isRunning) { // Only start if not already running
                 this._startRotation();
             } else {
                 log("Rotation toggle ON ignored, already running.");
             }
        } else {
             // User wants to stop rotation
             if (this._isRunning) { // Only stop if currently running
                 this._stopRotation();
             } else {
                 log("Rotation toggle OFF ignored, already stopped.");
             }
        }
         // Ensure internal state and UI are consistent after action
         this._isRunning = state;
         this._updateRotationSwitchLabel();
    }

    _onRandomToggled(item, state) {
        log(`Random order switch toggled to: ${state}`);
        if (this._useRandomOrder === state) {
            log("Random order unchanged.");
            return; // No change needed
        }

        this._useRandomOrder = state;

        // Save the setting
        try {
            if (this._extensionSettings && this._extensionSettings.settings_schema.has_key('random-order')) {
                if (this._extensionSettings.set_boolean('random-order', state)) {
                     log("Saved random-order setting.");
                 } else {
                     logError(new Error("GSettings set_boolean returned false for random-order."));
                 }
            } else {
                log("Cannot save random-order setting (key missing or settings object unavailable).");
            }
        } catch (e) {
            logError(e, `Could not save random-order setting`);
        }

        // No need to restart rotation immediately, the setting will be checked on the next timer fire.
         log(`Random order set to ${this._useRandomOrder}. Change will apply on next rotation.`);
    }

    _onSettingsActivated() {
        log("Settings button clicked.");
        try {
            // This requires the extension to have a prefs.js file defined in metadata.json
            ExtensionUtils.openPrefs();
        } catch (e) {
            logError(e, `Error opening preferences dialog. Ensure prefs.js is set up.`);
            Main.notifyError("Wallpaper Rotator", "Could not open settings dialog."); // User notification
        }
    }

    // --- Settings Change Handler ---

     _onSettingsChanged(settings, key) {
         log(`Settings key changed: ${key}`);
         let restartRotation = false; // Flag to check if timer needs restart

        switch (key) {
            case 'wallpaper-directory':
                const newDir = this._extensionSettings.get_string('wallpaper-directory');
                const effectiveDir = (newDir && newDir.trim() !== '') ? newDir : DEFAULT_WALLPAPER_DIR;
                if (effectiveDir !== this._wallpaperDir) {
                    log(`Wallpaper directory changed to: ${effectiveDir}. Reloading wallpapers.`);
                    this._wallpaperDir = effectiveDir;
                    this._loadWallpapers(); // This will update status and preview
                    restartRotation = this._isRunning; // Restart if running
                } else {
                     log("Wallpaper directory setting changed, but effective path is the same.");
                }
                break;

            case 'interval':
                const newInterval = this._extensionSettings.get_int('interval');
                 log(`Interval setting changed to: ${newInterval}`);
                if (newInterval > 0 && newInterval !== this._interval) {
                    this._interval = newInterval;
                    this._updateRotationSwitchLabel(); // Update label immediately
                    restartRotation = this._isRunning; // Restart if running
                    log(`Interval updated to ${this._interval} minutes.`);
                } else if (newInterval <= 0) {
                    log(`Invalid interval ${newInterval} from settings ignored. Keeping ${this._interval}.`);
                     // Optionally reset the setting to the current valid value or default
                     // settings.set_int('interval', this._interval);
                } else {
                     log("Interval setting changed, but value is the same.");
                }
                break;

            case 'random-order':
                 // Check schema key existence again just in case
                 if (settings.settings_schema.has_key('random-order')) {
                     try {
                         const newRandom = settings.get_boolean('random-order');
                         log(`Random order setting changed externally to: ${newRandom}`);
                         if (this._useRandomOrder !== newRandom) {
                             this._useRandomOrder = newRandom;
                             log(`Applied random order change from settings: ${this._useRandomOrder}`);
                             // Update the switch UI element
                             if (this._randomSwitch) {
                                 this._randomSwitch.setToggleState(newRandom);
                             }
                             // No need to restart rotation, it checks the flag on next run
                         } else {
                             log("Random order setting changed, but value is the same.");
                         }
                     } catch (e) {
                         logError(e, "Error reading changed 'random-order' setting.");
                     }
                 }
                break;

            // This case might be used if prefs.js triggers a manual reload signal
            case 'last-action':
                const action = settings.get_string('last-action');
                log(`Received last-action: ${action}`);
                if (action === 'force-reload') { // Example action name
                    log(`Force reload action received. Reloading wallpapers.`);
                    this._loadWallpapers();
                    restartRotation = this._isRunning;
                     // Reset the action key so it can be triggered again
                     settings.set_string('last-action', '');
                }
                break;

             default:
                 log(`Ignoring change for unhandled key: ${key}`);
                 break;
        }

         // Restart rotation timer if needed after handling the change
         if (restartRotation) {
             log("Restarting rotation timer due to settings change.");
             this._startRotation(); // This handles stopping the old timer too
         }
    }


    // --- Destruction ---

    destroy() {
        log("Destroying Wallpaper Rotator instance...");
        this._stopRotation(); // Stop timer first

        // Disconnect signal handlers
        if (this._extensionSettings && this._settingsChangedId) {
            this._extensionSettings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
            log("Disconnected settings change handler.");
        }
        if (this._interfaceSettings && this._colorSchemeMonitorId) {
            this._interfaceSettings.disconnect(this._colorSchemeMonitorId);
            this._colorSchemeMonitorId = null;
            log("Disconnected color scheme change handler.");
        }

        // Release GSettings objects
        this._extensionSettings = null;
        this._interfaceSettings = null;
        this._settings = null; // Desktop background settings

        // Clear references to UI elements (helps GC)
         // Menu items are destroyed when the menu is destroyed, which happens in super.destroy()
         this._statusLabel = null;
         this._previewContainer = null; // Was holding the preview
         this._rotationSwitch = null;
         this._randomSwitch = null;
         this._icon = null; // The panel icon


        // Clear data
        this._wallpapers = [];
        this._currentIndex = -1;


        // Call parent destroy method
         try {
            super.destroy();
            log("PanelMenu.Button destroyed successfully.");
         } catch (e) {
             logError(e, "Error during super.destroy()");
         }

        log("Wallpaper Rotator instance destroyed.");
    }
});

// --- Global Extension Functions ---

// Called once when extension is loaded (before enabling)
function init(metadata) {
    // Log initialization with version if available
    const version = metadata ? metadata.version : 'N/A';
     log(`Initializing Wallpaper Rotator extension v${version}`);
    // Can setup localization here using ExtensionUtils.initTranslations();
}

// Called when extension is enabled
function enable() {
    log(`Enabling Wallpaper Rotator extension`);
    try {
        if (wallpaperRotator !== null) {
            log("Instance already exists? Destroying previous one.");
            wallpaperRotator.destroy();
            wallpaperRotator = null;
        }
        wallpaperRotator = new WallpaperRotator();
        // Add to status area, '1' is index (position), 'wallpaper-rotator' is role name
        Main.panel.addToStatusArea('wallpaper-rotator', wallpaperRotator, 1, 'right'); // Explicitly add to right
        log(`Wallpaper Rotator added to panel.`);
    } catch(e) {
        logError(e, 'Failed to enable Wallpaper Rotator');
        // Cleanup if partial initialization failed
        if (wallpaperRotator) {
            try {
                wallpaperRotator.destroy();
            } catch (e2) {
                logError(e2, 'Error destroying instance during enable failure cleanup.');
            }
            wallpaperRotator = null;
        }
        // Optionally notify user of failure
        Main.notifyError("Wallpaper Rotator", "Failed to enable extension.");
    }
}

// Called when extension is disabled
function disable() {
    log(`Disabling Wallpaper Rotator extension`);
    if (wallpaperRotator) {
        try {
            // Main.panel.remove_actor(wallpaperRotator.container); // Not needed, destroy() handles removal from status area
            wallpaperRotator.destroy();
            log(`Wallpaper Rotator instance destroyed.`);
        } catch(e) {
            logError(e, 'Error destroying Wallpaper Rotator instance during disable.');
        } finally {
             // Ensure reference is cleared even if destroy() throws error
            wallpaperRotator = null;
        }
    } else {
        log("No active Wallpaper Rotator instance found to disable.");
    }
    log(`Wallpaper Rotator extension disabled.`);
}