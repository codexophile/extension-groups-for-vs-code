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
    let state: ExtensionGroupsState = context.globalState.get('extensionGroups') || { groups: [] };

    // Register the TreeDataProvider for the sidebar view
    const extensionGroupsProvider = new ExtensionGroupsProvider(state, context);
    vscode.window.registerTreeDataProvider('extensionGroups', extensionGroupsProvider);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('extension-groups.createGroup', async () => {
            const groupName = await vscode.window.showInputBox({
                placeHolder: 'Group Name',
                prompt: 'Enter a name for the new extension group'
            });

            if (groupName) {
                const newGroup: ExtensionGroup = {
                    id: Date.now().toString(),
                    name: groupName,
                    extensions: [],
                    isActive: false
                };

                state.groups.push(newGroup);
                await context.globalState.update('extensionGroups', state);
                extensionGroupsProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('extension-groups.deleteGroup', async (group: ExtensionGroupTreeItem) => {
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to delete the group "${group.label}"?`,
                'Yes', 'No'
            );

            if (confirmation === 'Yes') {
                state.groups = state.groups.filter(g => g.id !== group.groupId);
                await context.globalState.update('extensionGroups', state);
                extensionGroupsProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('extension-groups.addExtension', async (group: ExtensionGroupTreeItem) => {
            // Get all installed extensions
            const extensions = vscode.extensions.all
                .filter(ext => !ext.id.startsWith('vscode.'))
                .map(ext => ({ 
                    label: ext.packageJSON.displayName || ext.packageJSON.name,
                    id: ext.id
                }));
            
            const selectedExtension = await vscode.window.showQuickPick(extensions, {
                placeHolder: 'Select an extension to add to the group'
            });

            if (selectedExtension) {
                const targetGroup = state.groups.find(g => g.id === group.groupId);
                if (targetGroup && !targetGroup.extensions.includes(selectedExtension.id)) {
                    targetGroup.extensions.push(selectedExtension.id);
                    await context.globalState.update('extensionGroups', state);
                    extensionGroupsProvider.refresh();
                }
            }
        }),

        vscode.commands.registerCommand('extension-groups.removeExtension', async (extension: ExtensionTreeItem) => {
            const targetGroup = state.groups.find(g => g.id === extension.groupId);
            if (targetGroup) {
                targetGroup.extensions = targetGroup.extensions.filter(id => id !== extension.extensionId);
                await context.globalState.update('extensionGroups', state);
                extensionGroupsProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('extension-groups.activateGroup', async (group: ExtensionGroupTreeItem) => {
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
                            await vscode.commands.executeCommand('workbench.extensions.disableExtension', extId);
                        }
                    }
                }
                
                targetGroup.isActive = !targetGroup.isActive;
                await context.globalState.update('extensionGroups', state);
                extensionGroupsProvider.refresh();
                
                if (!targetGroup.isActive) {
                    // If we're disabling extensions, prompt for reload
                    const reload = await vscode.window.showInformationMessage(
                        'Some extensions have been disabled. Reload VS Code to apply changes?',
                        'Reload', 'Later'
                    );
                    
                    if (reload === 'Reload') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                }
            }
        }),

        vscode.commands.registerCommand('extension-groups.dragAndDrop', async (source: any, target: any) => {
            // Handle drag and drop reorganization
            if (source instanceof ExtensionTreeItem && target instanceof ExtensionGroupTreeItem) {
                // Moving an extension between groups
                const sourceGroup = state.groups.find(g => g.id === source.groupId);
                const targetGroup = state.groups.find(g => g.id === target.groupId);
                
                if (sourceGroup && targetGroup && sourceGroup.id !== targetGroup.id) {
                    // Remove from source group
                    sourceGroup.extensions = sourceGroup.extensions.filter(id => id !== source.extensionId);
                    
                    // Add to target group if not already present
                    if (!targetGroup.extensions.includes(source.extensionId)) {
                        targetGroup.extensions.push(source.extensionId);
                    }
                    
                    await context.globalState.update('extensionGroups', state);
                    extensionGroupsProvider.refresh();
                }
            } else if (source instanceof ExtensionGroupTreeItem && target instanceof ExtensionGroupTreeItem) {
                // Reordering groups
                const groups = [...state.groups];
                const sourceIndex = groups.findIndex(g => g.id === source.groupId);
                const targetIndex = groups.findIndex(g => g.id === target.groupId);
                
                if (sourceIndex !== -1 && targetIndex !== -1) {
                    const [movedGroup] = groups.splice(sourceIndex, 1);
                    groups.splice(targetIndex, 0, movedGroup);
                    
                    state.groups = groups;
                    await context.globalState.update('extensionGroups', state);
                    extensionGroupsProvider.refresh();
                }
            }
        }),

        vscode.commands.registerCommand('extension-groups.syncSettings', async () => {
            // Implement settings sync functionality
            try {
                // Save current state to a file in the user's settings directory
                const settingsPath = path.join(context.globalStorageUri.fsPath, 'extension-groups-sync.json');
                
                // Ensure the directory exists
                if (!fs.existsSync(path.dirname(settingsPath))) {
                    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
                }
                
                // Update sync timestamp
                state.lastSyncTime = Date.now();
                await context.globalState.update('extensionGroups', state);
                
                // Write to file
                fs.writeFileSync(settingsPath, JSON.stringify(state, null, 2));
                
                vscode.window.showInformationMessage(`Extension groups synced successfully at ${new Date(state.lastSyncTime).toLocaleString()}`);
                extensionGroupsProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to sync extension groups: ${error}`);
            }
        }),

        vscode.commands.registerCommand('extension-groups.importSettings', async () => {
            try {
                const settingsPath = path.join(context.globalStorageUri.fsPath, 'extension-groups-sync.json');
                
                if (fs.existsSync(settingsPath)) {
                    const data = fs.readFileSync(settingsPath, 'utf8');
                    const importedState = JSON.parse(data) as ExtensionGroupsState;
                    
                    state = importedState;
                    await context.globalState.update('extensionGroups', state);
                    extensionGroupsProvider.refresh();
                    
                    vscode.window.showInformationMessage('Extension groups imported successfully');
                } else {
                    vscode.window.showWarningMessage('No synced extension groups found');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to import extension groups: ${error}`);
            }
        })
    );
}

// Tree data provider for the sidebar view
class ExtensionGroupsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private state: ExtensionGroupsState,
        private context: vscode.ExtensionContext
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!element) {
            // Root level - show groups
            return Promise.resolve(this.state.groups.map(group => {
                const treeItem = new ExtensionGroupTreeItem(
                    group.name,
                    group.id,
                    group.isActive ? 
                        vscode.TreeItemCollapsibleState.Expanded : 
                        vscode.TreeItemCollapsibleState.Collapsed
                );
                
                treeItem.contextValue = 'extensionGroup';
                treeItem.iconPath = group.isActive ? 
                    new vscode.ThemeIcon('check') : 
                    new vscode.ThemeIcon('circle-outline');
                    
                return treeItem;
            }));
        } else if (element instanceof ExtensionGroupTreeItem) {
            // Group level - show extensions in the group
            const group = this.state.groups.find(g => g.id === element.groupId);
            
            if (group) {
                return Promise.resolve(group.extensions.map(extId => {
                    const ext = vscode.extensions.getExtension(extId);
                    const label = ext ? 
                        (ext.packageJSON.displayName || ext.packageJSON.name) : 
                        extId;
                        
                    const treeItem = new ExtensionTreeItem(
                        label,
                        extId,
                        group.id,
                        vscode.TreeItemCollapsibleState.None
                    );
                    
                    treeItem.contextValue = 'extension';
                    treeItem.iconPath = new vscode.ThemeIcon('extensions');
                    
                    return treeItem;
                }));
            }
        }
        
        return Promise.resolve([]);
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
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.tooltip = extensionId;
    }
}

export function deactivate() {}