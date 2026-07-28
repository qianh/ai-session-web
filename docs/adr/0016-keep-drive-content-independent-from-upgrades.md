# Keep Drive content independent from upgrades

BrainHub Capture treats previously written Drive sessions and highlights as stable user content, not application state. Extension releases may migrate extension-local settings but never perform a bulk Drive-content migration or rewrite, move, or delete historical content as part of an upgrade. Any future change to the content contract requires a separate explicit product decision rather than an ordinary component release.
