Anti-Fire для Linux (x86_64)

Запуск: распакуйте архив и запустите файл anti-fire.

    tar -xzf Anti-Fire-linux-x86_64.tar.gz
    ./Anti-Fire/anti-fire

Нужна системная библиотека WebKitGTK 4.1:

    Fedora:  sudo dnf install webkit2gtk4.1
    Ubuntu:  sudo apt install libwebkit2gtk-4.1-0

Anti-Fire — клиент сервиса SFSS. Сервис ставится отдельно, из репозитория:
./install.sh. Тогда кнопка «Запустить SFSS» в программе найдёт команду sfss сама.
Подробности: docs/install/linux.md в репозитории.
