'use strict';

const { Adw, Gio, GLib, Gtk, Gdk, Pango } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

function init() {
    // Placeholder if needed for future initialization logic
}

/**
 * Called by GNOME Shell to build the preferences widget.
 * @param {Adw.PreferencesWindow} window - The preferences window or container.
 */
function fillPreferencesWindow(window) {
    // Create a preferences page - holds all content
    const page = new Adw.PreferencesPage();

    // --- Settings Group ---
    const settingsGroup = new Adw.PreferencesGroup({
        title: 'Wallpaper Rotator Settings',
        description: 'Configure wallpaper rotation settings'
    });
    page.add(settingsGroup); // Add settings group to the page first

    // Get GSettings schema for the extension
    const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator');

    // --- Wallpaper Directory Row ---
    const dirRow = new Adw.ActionRow({
        title: 'Wallpaper Directory',
        subtitle: 'Select the folder containing your wallpapers'
    });

    const dirLabel = new Gtk.Label({
        label: settings.get_string('wallpaper-directory') || 'Not set',
        ellipsize: Pango.EllipsizeMode.MIDDLE,
        max_width_chars: 30,
        valign: Gtk.Align.CENTER
    });
    dirRow.add_suffix(dirLabel);

    const dirButton = new Gtk.Button({
        label: 'Choose Directory',
        valign: Gtk.Align.CENTER
    });
    dirRow.add_suffix(dirButton);
    settingsGroup.add(dirRow);

    // Action for the directory chooser button
    dirButton.connect('clicked', () => {
        const dialog = new Gtk.FileChooserNative({
            title: 'Select Wallpaper Directory',
            action: Gtk.FileChooserAction.SELECT_FOLDER,
            transient_for: window.get_root ? window.get_root() : window,
            modal: true
        });
        const currentPath = settings.get_string('wallpaper-directory');
        if (currentPath && currentPath !== '') {
            try {
                const file = Gio.File.new_for_path(currentPath);
                if (file.query_exists(null)) {
                    dialog.set_current_folder(file);
                }
            } catch (e) {
                log(`[Wallpaper Rotator] Error setting current folder for dialog: ${e.message}`);
            }
        }
        dialog.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = dialog.get_file();
                if (file) {
                    const path = file.get_path();
                    log(`[Wallpaper Rotator] Setting wallpaper directory to: ${path}`);
                    settings.set_string('wallpaper-directory', path);
                    dirLabel.set_label(path);
                }
            }
            dialog.destroy();
        });
        dialog.show();
    });

    // --- Rotation Interval Row ---
    const intervalRow = new Adw.ActionRow({
        title: 'Rotation Interval',
        subtitle: 'Minutes between wallpaper changes (1-1440)'
    });

    const intervalSpinButton = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 1440,
            step_increment: 1,
            page_increment: 10,
            value: settings.get_int('interval')
        }),
        valign: Gtk.Align.CENTER,
        numeric: true,
        digits: 0
    });
    intervalRow.add_suffix(intervalSpinButton);
    settingsGroup.add(intervalRow);

    // Bind the GSettings 'interval' key to the SpinButton's adjustment 'value' property
    settings.bind(
        'interval',
        intervalSpinButton.get_adjustment(),
        'value',
        Gio.SettingsBindFlags.DEFAULT
    );

    // --- Action Group (Optional - only for Open Directory Button now) ---
    // We keep this group for the "Open Directory" button, centered.
    const actionGroup = new Adw.PreferencesGroup();
    page.add(actionGroup); // Add this group after settings

    // --- Open Directory Button ---
    const openDirButton = new Gtk.Button({
        label: 'Open Wallpaper Directory',
        halign: Gtk.Align.CENTER, // Keep this centered
        margin_top: 10,
        margin_bottom: 5
    });
    openDirButton.connect('clicked', () => {
        const path = settings.get_string('wallpaper-directory');
        if (path && path !== '') {
            try {
                const file = Gio.File.new_for_path(path);
                if (!file.query_exists(null)) {
                     log(`[Wallpaper Rotator] Cannot open directory, it does not exist: ${path}`);
                     return;
                }
                const appInfo = Gio.AppInfo.get_default_for_type('inode/directory', true);
                if (appInfo) {
                    appInfo.launch_uris([file.get_uri()], null);
                } else {
                    log('[Wallpaper Rotator] Error: No default file manager found');
                }
            } catch (e) {
                log(`[Wallpaper Rotator] Error opening directory: ${e.message}`);
            }
        } else {
             log('[Wallpaper Rotator] No wallpaper directory set, cannot open.');
        }
    });
    actionGroup.add(openDirButton); // Add button to its group

    // --- Close Button Row (Positioned at the very bottom) ---
    const closeRow = new Adw.ActionRow({
        // Using an ActionRow provides structure and padding consistent with other rows.
        // We don't need title/subtitle. Make it non-interactive itself.
        activatable: false,
        selectable: false,
        // Add margin above this row to separate it visually
        margin_top: 20,
    });
    // Add this row LAST to the page so it appears at the bottom
    page.add(closeRow);

    // --- Close Settings Button (Aligned Right) ---
    const closeButton = new Gtk.Button({
        label: 'Close Settings',
        // *** Align the button itself to the END (right) within its container ***
        halign: Gtk.Align.END,
        valign: Gtk.Align.CENTER,
        // Add some margin around the button for spacing
        margin_top: 6,
        margin_bottom: 6,
        margin_start: 6,
        margin_end: 6, // Margin on the right edge
    });

    closeButton.connect('clicked', () => {
        const topLevelWindow = window.get_root ? window.get_root() : window;
        if (topLevelWindow && typeof topLevelWindow.close === 'function') {
            log('[Wallpaper Rotator] Closing preferences window via button.');
            topLevelWindow.close();
        } else {
            log('[Wallpaper Rotator] Could not find function to close the preferences window.');
        }
    });

    // Add the button as a suffix widget to the ActionRow.
    // Because the button's halign is END, it will be pushed to the right.
    closeRow.add_suffix(closeButton);

    // Finally, add the fully populated page to the window provided by the host app
    window.add(page);
}

/**
 * Fallback function for older GNOME versions or standalone execution.
 * Creates its own window and fills it.
 * @returns {Adw.PreferencesWindow} The preferences window widget.
 */
function buildPrefsWidget() {
    const prefsWidget = new Adw.PreferencesWindow();
    fillPreferencesWindow(prefsWidget); // Reuse the filling logic
    return prefsWidget;
}