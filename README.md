# Wallpaper Rotator GNOME Extension (v1)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

Automatically rotate desktop wallpapers from a selected folder using a convenient GNOME Shell indicator menu.

## Features

* **Automatic Rotation:** Change wallpapers periodically at user-defined intervals.
* **Manual Control:** Navigate forwards, backwards, or jump to a random wallpaper anytime.
* **Panel Indicator:** Access all features easily from the GNOME top panel.
* **Customizable:** Configure the wallpaper source directory and rotation frequency.
* **Random Order Toggle:** Choose between sequential or random rotation order.
* **Hover Preview:** See the next/previous wallpaper by hovering over the navigation buttons in the menu.

## Screenshots

<table>
  <tr>
    <td align="center" valign="top">
      <img src="https://raw.githubusercontent.com/tmeier-lang/wallpaper-rotator-extension/main/images/screenshot1.png" alt="Main Extension Menu" width="350">
      <br>
      <em>Main Extension Menu</em>
    </td>
    <td align="center" valign="top">
      <img src="https://raw.githubusercontent.com/tmeier-lang/wallpaper-rotator-extension/main/images/screenshot2.png" alt="Settings Dialog" width="350">
      <br>
      <em>Settings Dialog</em>
    </td>
  </tr>
</table>

## Compatibility

* **GNOME Shell Versions:** Officially supports versions **42, 43, and 44** (as per `metadata.json`).
* **Note:** As of April 2025, newer GNOME versions (45, 46+) have been released. Compatibility with these versions has not been confirmed. Testing and potential updates may be required.

## Installation

**Important:** The unique identifier (UUID) for this extension is `wallpaper-rotator-extension@tmeier-lang.github.io`. Ensure this exact UUID is used in the commands and directory names below.

### Recommended Method: extensions.gnome.org (EGO)

*This extension is not yet available on extensions.gnome.org.*

### Alternative Method: Manual Installation from Source

If you prefer to install manually from this source code (version 1):

1.  **Prerequisites:** Ensure you have `git` and `glib-compile-schemas` installed.
    ```bash
    # Example for Debian/Ubuntu:
    # sudo apt update && sudo apt install git gettext glib-networking
    # Example for Fedora:
    # sudo dnf install git gettext glib-networking glib2-devel
    ```
    *(Note: `gettext` may be needed for future translations; `glib2-devel` often includes `glib-compile-schemas`)*

2.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/tmeier-lang/wallpaper-rotator-extension.git](https://github.com/tmeier-lang/wallpaper-rotator-extension.git)
    cd wallpaper-rotator-extension
    ```

3.  **Define Your UUID:** (This matches the `uuid` in `metadata.json`)
    ```bash
    UUID="wallpaper-rotator-extension@tmeier-lang.github.io"
    ```

4.  **Copy Files:** Create the extension directory and copy the necessary files:
    ```bash
    INSTALL_PATH="$HOME/.local/share/gnome-shell/extensions/$UUID"
    mkdir -p "$INSTALL_PATH/schemas"
    mkdir -p "$INSTALL_PATH/icons" # Ensure icons dir exists at destination

    # Copy code, metadata, UI, styles, schema source
    cp extension.js metadata.json prefs.js stylesheet.css "$INSTALL_PATH/"
    cp schemas/org.gnome.shell.extensions.wallpaper-rotator.gschema.xml "$INSTALL_PATH/schemas/"
    # Copy icons INTO the icons subdirectory
    cp icons/*.svg "$INSTALL_PATH/icons/"

    # Optionally copy README etc. - not needed for runtime
    # cp README.md "$INSTALL_PATH/"
    ```

5.  **Compile Schema at Destination:** Compile the schema *after* copying it to the installation path.
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
    * Or, open the **Extensions** application (or GNOME Tweaks) and enable "Wallpaper Rotator".

## Usage

Once installed and enabled:

1.  Find the **Wallpaper Rotator icon** (a stylized image icon) in your GNOME top panel.
2.  Click the icon to open the menu.
3.  View the current wallpaper preview and status.
4.  Use the **toggle switches** to enable/disable auto-rotation or random order.
5.  Navigate manually using the **"<" (Previous)**, **">" (Next)**, or **center (Random)** buttons. Hover over "<" or ">" to preview.
6.  Click **"Refresh Wallpaper List"** to rescan the source directory.
7.  Click **"Settings"** to open the configuration window.

## Configuration

Customize the extension via the Settings window (accessed from the extension's menu):

* **Wallpaper Directory:** Select the folder containing your desired wallpaper images. Ensure the folder exists and contains readable image files (e.g., `.jpg`, `.png`, `.webp`). (Defaults to your system's `Pictures` folder if not set).
* **Rotation Interval (minutes):** Set how frequently the wallpaper should change automatically when auto-rotate is on. (Default: `60` minutes. Valid range: `1` to `1440`).
* **Random Order:** Toggle whether wallpapers rotate sequentially or randomly when auto-rotate is on.

## Source Code Structure

The source code repository contains the following key files and directories (**icons are now in icons/**):

```
wallpaper-rotator-extension/
├── .gitignore          # Optional Git ignore file
├── extension.js        # Main extension logic
├── metadata.json       # Extension metadata (UUID, versions, etc.)
├── prefs.js            # Code for the Settings dialog UI
├── stylesheet.css      # Optional CSS for styling menu/dialog
├── icons/              # Panel icons (light/dark variants)
│   ├── icon-dark.svg
│   └── icon-light.svg
├── images/             # Optional: For README screenshots
│   ├── screenshot1.png # Main menu screenshot
│   └── screenshot2.png # Settings menu screenshot
├── schemas/            # GSettings schema definition
│   └── org.gnome.shell.extensions.wallpaper-rotator.gschema.xml
└── README.md           # This file
```

*Note: The compiled schema file (`gschemas.compiled`) is generated during installation inside the `schemas` directory within your installation path (`~/.local/share/gnome-shell/extensions/$UUID/schemas/`), it is not stored in the source repository.*

## Troubleshooting

* **Extension Not Loading/Enabled:** Verify compatibility with your GNOME Shell version. Double-check the installation directory name matches the UUID exactly: `wallpaper-rotator-extension@tmeier-lang.github.io`. Ensure GNOME Shell was restarted. Check logs (`journalctl /usr/bin/gnome-shell -f` or Logs app) for errors related to the UUID. Check that icon files were copied correctly into `$INSTALL_PATH/icons/`.
* **Settings Not Working / Not Saving:** Ensure `glib-compile-schemas "$INSTALL_PATH/schemas/"` ran successfully *after* copying files. Verify the schema ID in `metadata.json` and the `.gschema.xml` file match (`org.gnome.shell.extensions.wallpaper-rotator`).
* **Wallpapers Not Changing:** Confirm the selected Wallpaper Directory exists, contains supported image files (`.png`, `.jpg`, `.webp`, etc.), and that your user has read permissions for the folder and files. Check the Rotation Interval and ensure Auto-Rotate is enabled. Use "Refresh Wallpaper List" if you added images recently.
* **Preview Not Showing/Correct:** Check file permissions for images. Ensure images haven't been deleted. If hover preview seems stuck, try closing and reopening the menu.

## Contributing / Bug Reports

Found a bug or have a feature suggestion? Please open an issue on the [GitHub Issues page](https://github.com/tmeier-lang/wallpaper-rotator-extension/issues).

Contributions are welcome! Please submit pull requests via GitHub.

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE file](https://www.gnu.org/licenses/gpl-3.0.en.html) for details.