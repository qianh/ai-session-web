# Separate disconnection from user-data deletion

BrainHub Capture provides an explicit disconnect action that revokes its Google authorization and clears extension-local state. Chrome remains responsible for installing and uninstalling the extension. Disconnecting or uninstalling Capture never deletes the user's `brain-hub` folder or any Drive content written by the extension.
