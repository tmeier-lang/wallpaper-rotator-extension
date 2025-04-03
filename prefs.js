'use strict';

const { Adw, Gio, Gtk, Pango } = imports.gi;
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
        const dialog = new Gtk.FileChooserDialog({
            title: 'Select Wallpaper Directory',
            action: Gtk.FileChooserAction.SELECT_FOLDER,
            transient_for: window,
            modal: true
        });
        
        // Set current folder if it exists
        const currentPath = settings.get_string('wallpaper-directory');
        if (currentPath) {
            dialog.set_current_folder(Gio.File.new_for_path(currentPath));
        }
        
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Select', Gtk.ResponseType.ACCEPT);

        dialog.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const path = dialog.get_file().get_path();
                settings.set_string('wallpaper-directory', path);
                dirLabel.set_label(path);
                
                // Notify extension of change
                settings.apply();
            }
            dialog.destroy();
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