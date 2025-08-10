import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Define the structure for extension groups
interface ExtensionGroup {
  id: string;
  name: string;
  extensions: string[]; // Array of extension IDs
  isActive: boolean;
}

interface ExtensionGroupsState {
  groups: ExtensionGroup[];
  lastSyncTime?: number;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension Groups activated');

  // Initialize storage for extension groups
  let state: ExtensionGroupsState = context.globalState.get(
    'extensionGroups'
  ) || { groups: [] };

  // Register the TreeDataProvider for the activity bar view only
  const extensionGroupsProvider = new ExtensionGroupsProvider(state, context);
  vscode.window.createTreeView('extensionGroups', {
    treeDataProvider: extensionGroupsProvider,
    dragAndDropController: extensionGroupsProvider,
    canSelectMany: true,
  });

  // Helper to update provider state after any state change
  function updateProviderState() {
    let newState = context.globalState.get(
      'extensionGroups'
    ) as ExtensionGroupsState;
    if (!newState || !Array.isArray(newState.groups)) newState = { groups: [] };
    extensionGroupsProvider.setState(newState);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'extension-groups.createGroup',
      async () => {
        const groupName = await vscode.window.showInputBox({
          placeHolder: 'Group Name',
          prompt: 'Enter a name for the new extension group',
        });

        if (groupName) {
          const newGroup: ExtensionGroup = {
            id: Date.now().toString(),
            name: groupName,
            extensions: [],
            isActive: false,
          };
          state.groups.push(newGroup);
          await context.globalState.update('extensionGroups', state);
          updateProviderState();
        }
      }
    ),

    vscode.commands.registerCommand(
      'extension-groups.deleteGroup',
      async (group: ExtensionGroupTreeItem) => {
        const confirmation = await vscode.window.showWarningMessage(
          `Are you sure you want to delete the group "${group.label}"?`,
          'Yes',
          'No'
        );

        if (confirmation === 'Yes') {
          state.groups = state.groups.filter(g => g.id !== group.groupId);
          await context.globalState.update('extensionGroups', state);
          updateProviderState();
        }
      }
    ),

    vscode.commands.registerCommand(
      'extension-groups.addExtension',
      async (group: ExtensionGroupTreeItem) => {
        // Get all installed extensions
        const extensions = vscode.extensions.all
          .filter(ext => !ext.id.startsWith('vscode.'))
          .map(ext => ({
            label: ext.packageJSON.displayName || ext.packageJSON.name,
            id: ext.id,
          }));

        const selectedExtension = await vscode.window.showQuickPick(
          extensions,
          {
            placeHolder: 'Select an extension to add to the group',
          }
        );

        if (selectedExtension) {
          const targetGroup = state.groups.find(g => g.id === group.groupId);
          if (
            targetGroup &&
            !targetGroup.extensions.includes(selectedExtension.id)
          ) {
            targetGroup.extensions.push(selectedExtension.id);
            await context.globalState.update('extensionGroups', state);
            updateProviderState();
          }
        }
      }
    ),

    vscode.commands.registerCommand(
      'extension-groups.removeExtension',
      async (extension: ExtensionTreeItem) => {
        const targetGroup = state.groups.find(g => g.id === extension.groupId);
        if (targetGroup) {
          targetGroup.extensions = targetGroup.extensions.filter(
            id => id !== extension.extensionId
          );
          await context.globalState.update('extensionGroups', state);
          updateProviderState();
        }
      }
    ),

    vscode.commands.registerCommand(
      'extension-groups.activateGroup',
      async (group: ExtensionGroupTreeItem) => {
        const targetGroup = state.groups.find(g => g.id === group.groupId);
        if (targetGroup) {
          // Toggle all extensions in the group
          for (const extId of targetGroup.extensions) {
            const ext = vscode.extensions.getExtension(extId);
            if (ext) {
              if (!targetGroup.isActive) {
                // Enable the extension
                if (!ext.isActive) {
                  await ext.activate();
                }
              } else {
                // Disable the extension - this requires a reload in VS Code
                await vscode.commands.executeCommand(
                  'workbench.extensions.disableExtension',
                  extId
                );
              }
            }
          }

          targetGroup.isActive = !targetGroup.isActive;
          await context.globalState.update('extensionGroups', state);
          updateProviderState();

          if (!targetGroup.isActive) {
            // If we're disabling extensions, prompt for reload
            const reload = await vscode.window.showInformationMessage(
              'Some extensions have been disabled. Reload VS Code to apply changes?',
              'Reload',
              'Later'
            );

            if (reload === 'Reload') {
              vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
          }
        }
      }
    ),

    vscode.commands.registerCommand(
      'extension-groups.dragAndDrop',
      async (source: any, target: any) => {
        // Handle drag and drop reorganization
        if (
          source instanceof ExtensionTreeItem &&
          target instanceof ExtensionGroupTreeItem
        ) {
          // Moving an extension between groups
          const sourceGroup = state.groups.find(g => g.id === source.groupId);
          const targetGroup = state.groups.find(g => g.id === target.groupId);

          if (sourceGroup && targetGroup && sourceGroup.id !== targetGroup.id) {
            // Remove from source group
            sourceGroup.extensions = sourceGroup.extensions.filter(
              id => id !== source.extensionId
            );

            // Add to target group if not already present
            if (!targetGroup.extensions.includes(source.extensionId)) {
              targetGroup.extensions.push(source.extensionId);
            }

            await context.globalState.update('extensionGroups', state);
            updateProviderState();
          }
        } else if (
          source instanceof ExtensionGroupTreeItem &&
          target instanceof ExtensionGroupTreeItem
        ) {
          // Reordering groups
          const groups = [...state.groups];
          const sourceIndex = groups.findIndex(g => g.id === source.groupId);
          const targetIndex = groups.findIndex(g => g.id === target.groupId);

          if (sourceIndex !== -1 && targetIndex !== -1) {
            const [movedGroup] = groups.splice(sourceIndex, 1);
            groups.splice(targetIndex, 0, movedGroup);

            state.groups = groups;
            await context.globalState.update('extensionGroups', state);
            updateProviderState();
          }
        }
      }
    ),

    vscode.commands.registerCommand(
      'extension-groups.syncSettings',
      async () => {
        // Implement settings sync functionality
        try {
          // Save current state to a file in the user's settings directory
          const settingsPath = path.join(
            context.globalStorageUri.fsPath,
            'extension-groups-sync.json'
          );

          // Ensure the directory exists
          if (!fs.existsSync(path.dirname(settingsPath))) {
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
          }

          // Update sync timestamp
          state.lastSyncTime = Date.now();
          await context.globalState.update('extensionGroups', state);

          // Write to file
          fs.writeFileSync(settingsPath, JSON.stringify(state, null, 2));

          vscode.window.showInformationMessage(
            `Extension groups synced successfully at ${new Date(
              state.lastSyncTime
            ).toLocaleString()}`
          );
          updateProviderState();
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to sync extension groups: ${error}`
          );
        }
      }
    ),

    vscode.commands.registerCommand(
      'extension-groups.importSettings',
      async () => {
        try {
          const settingsPath = path.join(
            context.globalStorageUri.fsPath,
            'extension-groups-sync.json'
          );

          if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            const importedState = JSON.parse(data) as ExtensionGroupsState;

            state = importedState;
            await context.globalState.update('extensionGroups', state);
            updateProviderState();

            vscode.window.showInformationMessage(
              'Extension groups imported successfully'
            );
          } else {
            vscode.window.showWarningMessage(
              'No synced extension groups found'
            );
          }
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to import extension groups: ${error}`
          );
        }
      }
    )
  );
}

// Tree data provider for the sidebar view
class ExtensionGroupsProvider
  implements
    vscode.TreeDataProvider<vscode.TreeItem>,
    vscode.TreeDragAndDropController<vscode.TreeItem>
{
  readonly dropMimeTypes = ['application/vnd.code.extension'];
  readonly dragMimeTypes = ['application/vnd.code.extension'];

  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  > = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(
    private state: ExtensionGroupsState,
    private context: vscode.ExtensionContext
  ) {}

  setState(newState: ExtensionGroupsState) {
    this.state = newState;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (!element) {
      // Root level - show groups and the uncategorized group
      const groupItems = this.state.groups.map(group => {
        const treeItem = new ExtensionGroupTreeItem(
          group.name,
          group.id,
          group.isActive
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
        );
        treeItem.contextValue = 'extensionGroup';
        treeItem.iconPath = group.isActive
          ? new vscode.ThemeIcon('check')
          : new vscode.ThemeIcon('circle-outline');
        return treeItem;
      });

      // Compute uncategorized extensions
      const allGrouped = new Set(this.state.groups.flatMap(g => g.extensions));
      const uncategorized = vscode.extensions.all.filter(
        ext => !ext.id.startsWith('vscode.') && !allGrouped.has(ext.id)
      );
      if (uncategorized.length > 0) {
        const uncategorizedGroup = new ExtensionGroupTreeItem(
          'Uncategorized',
          '__uncategorized__',
          vscode.TreeItemCollapsibleState.Expanded
        );
        uncategorizedGroup.contextValue = 'extensionGroup';
        uncategorizedGroup.iconPath = new vscode.ThemeIcon('question');
        groupItems.push(uncategorizedGroup);
      }
      return Promise.resolve(groupItems);
    } else if (element instanceof ExtensionGroupTreeItem) {
      if (element.groupId === '__uncategorized__') {
        // Show uncategorized extensions
        const allGrouped = new Set(
          this.state.groups.flatMap(g => g.extensions)
        );
        const uncategorized = vscode.extensions.all.filter(
          ext => !ext.id.startsWith('vscode.') && !allGrouped.has(ext.id)
        );
        return Promise.resolve(
          uncategorized.map(ext => {
            const label = ext.packageJSON.displayName || ext.packageJSON.name;
            const iconRel = ext.packageJSON.icon;
            let iconPath: string | undefined;
            if (iconRel) {
              iconPath = path.join(ext.extensionPath, iconRel);
            }
            const description = ext.packageJSON.description || '';
            const categories = ext.packageJSON.categories || [];
            const treeItem = new ExtensionTreeItem(
              label,
              ext.id,
              '__uncategorized__',
              vscode.TreeItemCollapsibleState.None,
              { description, iconPath, categories }
            );
            treeItem.contextValue = 'extension';
            return treeItem;
          })
        );
      } else {
        // Group level - show extensions in the group
        const group = this.state.groups.find(g => g.id === element.groupId);
        if (group) {
          return Promise.resolve(
            group.extensions.map(extId => {
              const ext = vscode.extensions.getExtension(extId);
              let label = extId;
              let iconPath: string | undefined;
              let description = '';
              let categories: string[] = [];
              if (ext) {
                label = ext.packageJSON.displayName || ext.packageJSON.name;
                if (ext.packageJSON.icon) {
                  iconPath = path.join(ext.extensionPath, ext.packageJSON.icon);
                }
                description = ext.packageJSON.description || '';
                categories = ext.packageJSON.categories || [];
              }
              const treeItem = new ExtensionTreeItem(
                label,
                extId,
                group.id,
                vscode.TreeItemCollapsibleState.None,
                { description, iconPath, categories }
              );
              treeItem.contextValue = 'extension';
              return treeItem;
            })
          );
        }
      }
    }
    return Promise.resolve([]);
  }

  async handleDrag(
    source: vscode.TreeItem[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Only allow dragging ExtensionTreeItem
    const extItems = source.filter(
      item => item instanceof ExtensionTreeItem
    ) as ExtensionTreeItem[];
    if (extItems.length > 0) {
      const payload = extItems.map(item => ({
        extensionId: item.extensionId,
        groupId: item.groupId,
      }));
      dataTransfer.set(
        'application/vnd.code.extension',
        new vscode.DataTransferItem(JSON.stringify(payload))
      );
    }
  }

  async handleDrop(
    target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const extData = dataTransfer.get('application/vnd.code.extension');
    if (!extData) return;
    const raw = await extData.asString();
    let items: { extensionId: string; groupId: string }[];
    try {
      items = JSON.parse(raw);
    } catch {
      return;
    }

    // Determine target group id (allow dropping on group header or item)
    let targetGroupId: string | undefined;
    if (target instanceof ExtensionGroupTreeItem) {
      targetGroupId = target.groupId;
    } else if (target instanceof ExtensionTreeItem) {
      targetGroupId = target.groupId;
    }
    if (!targetGroupId) return;

    for (const { extensionId, groupId: sourceGroupId } of items) {
      // Remove from source group if present
      const sourceGroup = this.state.groups.find(g => g.id === sourceGroupId);
      if (sourceGroup) {
        sourceGroup.extensions = sourceGroup.extensions.filter(
          id => id !== extensionId
        );
      }
      // If target is Uncategorized, don't add to any group (it will appear in computed Uncategorized)
      if (targetGroupId !== '__uncategorized__') {
        const targetGroup = this.state.groups.find(g => g.id === targetGroupId);
        if (targetGroup && !targetGroup.extensions.includes(extensionId)) {
          targetGroup.extensions.push(extensionId);
        }
      }
    }

    await this.context.globalState.update('extensionGroups', this.state);
    // Refresh state from globalState to ensure UI updates
    let newState = this.context.globalState.get(
      'extensionGroups'
    ) as ExtensionGroupsState;
    if (!newState || !Array.isArray(newState.groups)) newState = { groups: [] };
    this.setState(newState);
  }
}

// Tree item for extension groups
class ExtensionGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly groupId: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label} (${this.groupId})`;
  }
}

// Tree item for extensions
class ExtensionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly extensionId: string,
    public readonly groupId: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    extMeta?: {
      description?: string;
      iconPath?: string;
      categories?: string[];
    }
  ) {
    super(label, collapsibleState);
    // Set icon
    if (extMeta?.iconPath) {
      this.iconPath = extMeta.iconPath;
    }
    // Set category/categories as description
    if (extMeta?.categories && extMeta.categories.length > 0) {
      this.description = extMeta.categories.join(', ');
    } else {
      this.description = '';
    }
    // Tooltip: name, description, categories, extensionId
    const details: string[] = [];
    details.push(`Name: ${label}`);
    if (extMeta?.description) {
      details.push(`Description: ${extMeta.description}`);
    }
    if (extMeta?.categories && extMeta.categories.length > 0) {
      details.push(`Category: ${extMeta.categories.join(', ')}`);
    }
    details.push(`ID: ${extensionId}`);
    this.tooltip = details.join('\n');
  }
}

export function deactivate() {}
