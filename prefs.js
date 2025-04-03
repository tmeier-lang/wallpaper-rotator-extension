'use strict';

const { Adw, Gio, GLib, Gtk, Gdk, Pango } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

function init() {
}

function fillPreferencesWindow(window) {
    // Create a preferences page
    const page = new Adw.PreferencesPage();
    
    // Create a preferences group
    const group = new Adw.PreferencesGroup({
        title: 'Wallpaper Rotator Settings',
        description: 'Configure wallpaper rotation settings'
    });
    page.add(group);

    // Get settings
    const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator');

    // Directory chooser
    const dirRow = new Adw.ActionRow({
        title: 'Wallpaper Directory',
        subtitle: 'Select the folder containing your wallpapers'
    });
    
    // Add label to show current directory
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
    group.add(dirRow);

    dirButton.connect('clicked', () => {
        const dialog = new Gtk.FileChooserNative({
            title: 'Select Wallpaper Directory',
            action: Gtk.FileChooserAction.SELECT_FOLDER,
            transient_for: window.get_root ? window.get_root() : window,
            modal: true
        });
        
        // Set current folder if it exists
        const currentPath = settings.get_string('wallpaper-directory');
        if (currentPath && currentPath !== '') {
            try {
                const file = Gio.File.new_for_path(currentPath);
                if (file.query_exists(null)) {
                    dialog.set_current_folder(file);
                }
            } catch (e) {
                log(`Error setting current folder: ${e.message}`);
            }
        }
        
        dialog.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = dialog.get_file();
                if (file) {
                    const path = file.get_path();
                    log(`Setting wallpaper directory to: ${path}`);
                    
                    // Update settings
                    settings.set_string('wallpaper-directory', path);
                    dirLabel.set_label(path);
                    
                    // Ensure the settings are saved immediately
                    Gio.Settings.sync();
                    
                    // Signal the change to the extension
                    settings.set_string('last-action', 'directory-changed');
                    
                    // Need to set this back to empty to ensure future changes get detected
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                        settings.set_string('last-action', '');
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        });
        
        dialog.show();
    });

    // Interval spinbutton
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
        valign: Gtk.Align.CENTER
    });
    intervalRow.add_suffix(intervalSpinButton);
    group.add(intervalRow);

    // Bind settings
    settings.bind(
        'interval',
        intervalSpinButton,
        'value',
        Gio.SettingsBindFlags.DEFAULT
    );
    
    // Add a "Preview" button to open the selected directory
    const actionGroup = new Adw.PreferencesGroup();
    page.add(actionGroup);
    
    const openDirButton = new Gtk.Button({
        label: 'Open Wallpaper Directory',
        halign: Gtk.Align.CENTER,
        margin_top: 20
    });
    
    openDirButton.connect('clicked', () => {
        const path = settings.get_string('wallpaper-directory');
        if (path && path !== '') {
            try {
                const file = Gio.File.new_for_path(path);
                
                // Get launcher for directory
                const appInfo = Gio.AppInfo.get_default_for_type('inode/directory', true);
                if (appInfo) {
                    const uris = [file.get_uri()];
                    appInfo.launch_uris(uris, null);
                } else {
                    log('Error: No default file manager found');
                }
            } catch (e) {
                log(`Error opening directory: ${e.message}`);
            }
        }
    });
    
    actionGroup.add(openDirButton);

    // Add the page to the window
    window.add(page);
}

function buildPrefsWidget() {
    const widget = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
    });
    
    fillPreferencesWindow(widget);
    widget.show();
    return widget;
}