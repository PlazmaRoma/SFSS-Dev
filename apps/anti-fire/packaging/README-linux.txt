Anti-Fire for Linux (x86_64)

Start: unpack the archive and run the anti-fire file.

    tar -xzf Anti-Fire-linux-x86_64.tar.gz
    ./Anti-Fire/anti-fire

The window needs the WebKitGTK 4.1 library:

    Fedora:  sudo dnf install webkit2gtk4.1
    Ubuntu:  sudo apt install libwebkit2gtk-4.1-0

Anti-Fire is a client of the SFSS service. Install the service from the repository with
./install.sh, and the "Start SFSS" button will find the sfss command by itself.
Details: docs/install/linux.md in the repository.
