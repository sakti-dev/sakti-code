{
  description = "Electrobun SolidJS app";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        runtimeLibs = with pkgs; [
          # Electrobun Linux native dependencies
          # (from src/native/linux/nativeWrapper.cpp includes)
          gtk3
          webkitgtk_4_1
          libsoup_3
          libayatana-appindicator
          libx11
          libxext
          libxcursor
          libxfixes
          libxrandr
          libxcomposite
          libxdamage
          libxscrnsaver
          glib-networking

          # GTK dialogs (file picker, etc.)
          adwaita-icon-theme
          gsettings-desktop-schemas

          # Runtime / general
          glib
          cairo
          gdk-pixbuf
          at-spi2-atk
          pango
          harfbuzz
          fontconfig
          freetype
          stdenv.cc.cc.lib
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            zig_0_13
          ] ++ runtimeLibs;

          shellHook = ''
            export GDK_BACKEND=x11
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath runtimeLibs}:$LD_LIBRARY_PATH"
            export XDG_DATA_DIRS="${pkgs.adwaita-icon-theme}/share:${pkgs.gsettings-desktop-schemas}/share:${pkgs.shared-mime-info}/share:$XDG_DATA_DIRS"
          '';
        };
      }
    );
}
