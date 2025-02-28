# Extension Groups for VS Code

Organize your VS Code extensions into manageable groups with drag-and-drop support and settings synchronization.

## Features

- **Create Extension Groups**: Organize extensions into logical groups based on projects, languages, or workflows
- **Drag-and-Drop Organization**: Easily reorganize extensions between groups
- **Group Activation**: Enable or disable entire groups of extensions with a single click
- **Settings Sync**: Save and restore your extension groups across different machines
- **Visual Management**: Manage all your extensions through an intuitive sidebar UI

## How to Use

### Creating Groups

1. Open the Extension Groups view in the Explorer sidebar
2. Click the "+" icon in the view header to create a new group
3. Enter a name for your group

### Adding Extensions to Groups

1. Select a group in the sidebar
2. Click the "+" icon next to the group
3. Select an extension from the list to add it to the group

### Activating/Deactivating Groups

Click the "play" icon next to a group to toggle activation. When activated, all extensions in the group will be enabled. When deactivated, all extensions in the group will be disabled.

### Organizing Extensions

Drag extensions between groups to reorganize them. You can also change the order of groups by dragging them up or down in the sidebar.

### Syncing Settings

- Click the "cloud upload" icon in the view header to save your current extension groups configuration
- Click the "cloud download" icon to restore a previously saved configuration

## Requirements

- Visual Studio Code version 1.60.0 or higher

## Extension Settings

This extension doesn't require any specific settings.

## Known Issues

- Disabling extensions requires a VS Code reload to take effect (this is a VS Code limitation)
- Drag-and-drop may not work perfectly in all cases due to VS Code API limitations

## Release Notes

### 0.1.0

Initial release with basic grouping, drag-and-drop, and sync functionality.
