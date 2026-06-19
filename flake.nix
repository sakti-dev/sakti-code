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
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            zig_0_13

            # Electrobun Linux native dependencies
            # (from src/native/linux/nativeWrapper.cpp includes)
            gtk3
            webkitgtk_4_1
            libsoup_3
            libayatana-appindicator
            xorg.libX11
            xorg.libXext
            xorg.libXcursor
            xorg.libXfixes
            xorg.libXrandr
            xorg.libXcomposite
            xorg.libXdamage
            xorg.libXScrnSaver

            # Runtime / general
            glib
            cairo
            gdk-pixbuf
            at-spi2-atk
            pango
            harfbuzz
            fontconfig
            freetype
            stdenv.cc
          ];

          shellHook = ''
            export GDK_BACKEND=x11
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
          '';
        };
      }
    );
}
