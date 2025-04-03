# Wallpaper Rotator GNOME Extension (v1)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
Automatically rotate desktop wallpapers from a selected folder using a convenient GNOME Shell indicator menu.

## Features

* **Automatic Rotation:** Change wallpapers periodically at user-defined intervals.
* **Manual Control:** Navigate forwards, backwards, or jump to a random wallpaper anytime.
* **Panel Indicator:** Access all features easily from the GNOME top panel.
* **Customizable:** Configure the wallpaper source directory and rotation frequency.

## Compatibility

* **GNOME Shell Versions:** Officially supports versions **42, 43, and 44** (as per `metadata.json`).
* **Note:** (As of April 2025) Newer GNOME versions (45, 46+) have been released. Compatibility with these versions has not been confirmed yet. Testing and potential updates may be required.

## Installation

**Important:** The unique identifier (UUID) for this extension is `wallpaper-rotator-extension@tmeier-lang.github.io`. Ensure this exact UUID is used in the commands and directory names below.

### Recommended Method: extensions.gnome.org (EGO)

*This extension is not yet available on extensions.gnome.org.*

### Alternative Method: Manual Installation from Source

If you prefer to install manually from this source code (version 1):

1.  **Prerequisites:** Ensure you have `git` and `glib-compile-schemas` installed. These are usually standard on GNOME-based systems.
    ```bash
    # Example for Debian/Ubuntu:
    # sudo apt update && sudo apt install git gettext glib-networking
    # Example for Fedora:
    # sudo dnf install git gettext glib-networking glib2-devel
    ```
    *(Note: `gettext` is needed if you plan translations; `glib-networking` for potential web features, `glib2-devel` often includes `glib-compile-schemas`)*

2.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/tmeier-lang/wallpaper-rotator-extension.git](https://github.com/tmeier-lang/wallpaper-rotator-extension.git)
    cd wallpaper-rotator-extension
    ```

3.  **Define Your UUID:** (This matches the `uuid` in `metadata.json`)
    ```bash
    UUID="wallpaper-rotator-extension@tmeier-lang.github.io"
    ```

4.  **Copy Files:** Create the extension directory using the correct UUID and copy the necessary files.
    ```bash
    INSTALL_PATH="$HOME/.local/share/gnome-shell/extensions/$UUID"

    mkdir -p "$INSTALL_PATH"
    # Copy essential files identified from your project
    cp extension.js prefs.js metadata.json icon.svg stylesheet.css "$INSTALL_PATH/"
    # Copy the schemas directory
    cp -r schemas "$INSTALL_PATH/"
    ```

5.  **Compile Settings Schema:** This makes your extension's settings available to GNOME.
    ```bash
    glib-compile-schemas "$INSTALL_PATH/schemas/"
    ```

6.  **Restart GNOME Shell:**
    * On **X11:** Press `Alt` + `F2`, type `r`, and press `Enter`.
    * On **Wayland:** Log out and log back in.

7.  **Enable the Extension:**
    * Using the command line:
        ```bash
        gnome-extensions enable "$UUID"
        ```
    * Or, open the **Extensions** application (or GNOME Tweaks) and enable "Wallpaper Rotator" using the toggle switch. Ensure you are running a compatible GNOME Shell version (42, 43, or 44).

## Usage

Once installed and enabled on a compatible GNOME version:

1.  Find the **Wallpaper Rotator icon** in your GNOME top panel.
2.  Click the icon to open the menu.
3.  Use the **toggle switch** to enable or disable automatic rotation.
4.  Navigate manually using the **"Previous"**, **"Next"**, or **"Random"** menu items.
5.  Click **"Settings"** to open the configuration window.

## Configuration

You can customize the extension's behavior via the Settings window accessed from the extension's menu:

* **Wallpaper Directory:** Select the folder containing your desired wallpaper images. Ensure the folder contains readable image files (e.g., `.jpg`, `.png`, `.jpeg`). (Default: *None - must be set by user*)
* **Rotation Interval (minutes):** Set how frequently the wallpaper should change automatically. (Default: `60` minutes. Allowed range: `1` to `1440` minutes).

## Source Code Structure

The source code repository contains the following key files:

wallpaper-rotator-extension/
├── .gitignore
├── extension.js
├── icon.svg
├── metadata.json
├── prefs.js
├── README.md
├── schemas/
│   └── org.gnome.shell.extensions.wallpaper-rotator.gschema.xml
└── stylesheet.css

*Note: The `gschemas.compiled` file is generated during installation within the `schemas` directory in your installation path (`~/.local/share/gnome-shell/extensions/$UUID/`), not stored in the source repository.*

## Troubleshooting

* **Extension Not Loading/Enabled:** Verify you are running a compatible GNOME Shell version (42, 43, or 44). Double-check that the installation directory name under `~/.local/share/gnome-shell/extensions/` exactly matches the UUID: `wallpaper-rotator-extension@tmeier-lang.github.io`. Ensure you've restarted GNOME Shell and tried enabling via the Extensions app. Check GNOME Shell logs (`journalctl /usr/bin/gnome-shell -f`) for errors.
* **Settings Not Working / Not Saving:** Ensure you ran `glib-compile-schemas "$INSTALL_PATH/schemas/"` correctly during installation. Verify the schema ID `org.gnome.shell.extensions.wallpaper-rotator` in `metadata.json` matches the ID inside the `.gschema.xml` file.
* **Wallpapers Not Changing:** Verify the selected Wallpaper Directory exists, contains valid image files, and the extension has permission to read it. Check the Rotation Interval setting.

## Contributing / Bug Reports

Found a bug or have a feature suggestion? Please open an issue on the [GitHub Issues page](https://github.com/tmeier-lang/wallpaper-rotator-extension/issues).

Contributions are welcome! Please submit pull requests via GitHub.

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details. (Assuming you have a LICENSE file in your repo).