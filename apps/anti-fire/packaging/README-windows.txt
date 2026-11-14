Anti-Fire for Windows (x64)

Start: unpack the archive and open Anti-Fire.exe.
It needs WebView2, which Windows 10 and 11 already have.
On first start SmartScreen may warn about an unknown publisher:
"More info" -> "Run anyway". The build is unsigned.

Anti-Fire is a client of the SFSS service. Install the service from the repository with
install.ps1, and the "Start SFSS" button will find the sfss command by itself.
Details: docs/install/windows.md in the repository.
