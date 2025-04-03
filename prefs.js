// prefs.js - Extension preferences
const { GObject, Gtk, Gio, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Config = imports.misc.config;
const [major] = Config.PACKAGE_VERSION.split('.');
const shellVersion = Number.parseInt(major);

// Create a preferences widget using the appropriate style for GNOME version
function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator');
    
    // Create a preferences page
    const page = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
        spacing: 20,
        halign: Gtk.Align.CENTER,
    });
    
    // Directory selection
    const dirFrame = new Gtk.Frame({
        label: "Wallpaper Directory",
        margin_bottom: 12,
    });
    
    const dirBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
        spacing: 12,
    });
    
    const dirEntry = new Gtk.Entry({
        hexpand: true,
    });
    
    // Initialize directory
    dirEntry.text = settings.get_string('wallpaper-directory') || 
                    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
    
    const dirButton = new Gtk.Button({
        label: "Browse...",
    });
    
    dirButton.connect('clicked', () => {
        const dialog = new Gtk.FileChooserDialog({
            title: 'Select Wallpaper Directory',
            action: Gtk.FileChooserAction.SELECT_FOLDER,
            transient_for: window.get_root(),
            modal: true,
        });
        
        dialog.add_button("Cancel", Gtk.ResponseType.CANCEL);
        dialog.add_button("Select", Gtk.ResponseType.ACCEPT);
        
        dialog.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                dirEntry.text = dialog.get_file().get_path();
                settings.set_string('wallpaper-directory', dirEntry.text);
            }
            dialog.destroy();
        });
        
        dialog.show();
    });
    
    dirEntry.connect('changed', () => {
        settings.set_string('wallpaper-directory', dirEntry.text);
    });
    
    dirBox.append(dirEntry);
    dirBox.append(dirButton);
    dirFrame.set_child(dirBox);
    page.append(dirFrame);
    
    // Interval setting
    const intervalFrame = new Gtk.Frame({
        label: "Rotation Settings",
        margin_bottom: 12,
    });
    
    const intervalBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
        spacing: 12,
    });
    
    const intervalLabel = new Gtk.Label({
        label: "Change interval (minutes):",
        xalign: 0,
    });
    
    const intervalSpinner = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 1440,
            step_increment: 1,
            page_increment: 10,
            value: settings.get_int('interval') || 60,
        }),
        climb_rate: 1,
        digits: 0,
        numeric: true,
    });
    
    intervalSpinner.connect('value-changed', () => {
        settings.set_int('interval', intervalSpinner.get_value_as_int());
    });
    
    intervalBox.append(intervalLabel);
    intervalBox.append(intervalSpinner);
    intervalFrame.set_child(intervalBox);
    page.append(intervalFrame);
    
    // Add page to window
    window.add(page);
}

// For backwards compatibility with older GNOME versions
function init() {
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