# Use one fixed Drive root per account

BrainHub Capture uses the single `brain-hub` folder located directly under My Drive as the captured-content root for each Google account. It reuses that folder regardless of component installation order and does not offer a configurable root path. This fixed contract lets independently installed BrainHub components interoperate without shared local configuration. If multiple root-level folders have that name, Capture blocks writes until the user selects the canonical folder; it never guesses, merges, or deletes folders automatically.
