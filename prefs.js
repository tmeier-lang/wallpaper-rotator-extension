'use strict';

const { Adw, Gio, GLib, Gtk, Gdk, Pango } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

function init() {}

function fillPreferencesWindow(window) {
    const page = new Adw.PreferencesPage();
    const settingsGroup = new Adw.PreferencesGroup({
        title: 'Wallpaper Rotator Settings',
        description: 'Configure wallpaper rotation settings'
    });
    page.add(settingsGroup);

    const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.wallpaper-rotator');

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
            } catch (e) {}
        }
        dialog.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = dialog.get_file();
                if (file) {
                    const path = file.get_path();
                    settings.set_string('wallpaper-directory', path);
                    dirLabel.set_label(path);
                }
            }
            dialog.destroy();
        });
        dialog.show();
    });

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

    settings.bind(
        'interval',
        intervalSpinButton.get_adjustment(),
        'value',
        Gio.SettingsBindFlags.DEFAULT
    );

    const actionGroup = new Adw.PreferencesGroup();
    page.add(actionGroup);

    const openDirButton = new Gtk.Button({
        label: 'Open Wallpaper Directory',
        halign: Gtk.Align.CENTER,
        margin_top: 10,
        margin_bottom: 5
    });
    openDirButton.connect('clicked', () => {
        const path = settings.get_string('wallpaper-directory');
        if (path && path !== '') {
            try {
                const file = Gio.File.new_for_path(path);
                if (!file.query_exists(null)) return;
                const appInfo = Gio.AppInfo.get_default_for_type('inode/directory', true);
                if (appInfo) {
                    appInfo.launch_uris([file.get_uri()], null);
                }
            } catch (e) {}
        }
    });
    actionGroup.add(openDirButton);

    const closeRow = new Adw.ActionRow({
        activatable: false,
        selectable: false,
        margin_top: 20,
    });
    page.add(closeRow);

    const closeButton = new Gtk.Button({
        label: 'Close Settings',
        halign: Gtk.Align.END,
        valign: Gtk.Align.CENTER,
        margin_top: 6,
        margin_bottom: 6,
        margin_start: 6,
        margin_end: 6,
    });

    closeButton.connect('clicked', () => {
        const topLevelWindow = window.get_root ? window.get_root() : window;
        if (topLevelWindow && typeof topLevelWindow.close === 'function') {
            topLevelWindow.close();
        }
    });

    closeRow.add_suffix(closeButton);
    window.add(page);
}

function buildPrefsWidget() {
    const prefsWidget = new Adw.PreferencesWindow();
    fillPreferencesWindow(prefsWidget);
    return prefsWidget;
}