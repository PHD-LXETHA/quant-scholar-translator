# Quant Scholar Safari Web Extension

This directory is a Safari Web Extension source bundle for iPhone, iPad, and macOS Safari. It contains no browser popup: the Safari action toggles a draggable in-page QS menu.

The extension reads only webpage-accessible caption tracks. It cannot universally capture another iOS tab's audio. Translation is performed by the paired Quant Scholar service on the user's computer, and only final translations are retained.

Build the uploadable source ZIP on Windows with `scripts/build-safari-package.ps1`. Installation on Apple devices still requires Apple's Web Extension packaging/signing or App Store Connect workflow.
