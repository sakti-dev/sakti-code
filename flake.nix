{
  description = "sakti-code - Electron + SolidJS + pnpm dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # All runtime dependencies for Electron
        electronLibs = with pkgs; [
          # Core libraries
          glib
          gtk3
          nss
          nspr
          alsa-lib
          at-spi2-atk
          cups
          dbus
          expat

          # Graphics/OpenGL
          libglvnd
          libgbm
          mesa
          libGL
          libGLU
          libdrm
          libxkbcommon

          # X11
          xorg.libX11
          xorg.libXcomposite
          xorg.libXdamage
          xorg.libXext
          xorg.libXfixes
          xorg.libXrandr
          xorg.libXcursor
          xorg.libXi
          xorg.libXScrnSaver
          libxcb

          # Fonts and UI
          cairo
          pango
          liberation_ttf

          # Media
          ffmpeg

          # System/hardware
          systemd
          udev

          # C++ runtime for onnxruntime-node / fastembed
          gcc.cc.lib
          stdenv.cc.cc.lib
          stdenv.cc.cc

          # Additional dependencies for native modules
          zlib
          libgcc
        ];

      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            pnpm
            electron
            git
          ] ++ electronLibs;

          shellHook = ''
            # Library paths
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronLibs}:$LD_LIBRARY_PATH"
            export PATH="${pkgs.lib.makeBinPath [pkgs.nodejs_22 pkgs.pnpm pkgs.electron pkgs.git]}:$PATH"

            # Locale
            export LOCALE_ARCHIVE="${pkgs.glibcLocales}/lib/locale/locale-archive"

            # Electron configuration
            export ELECTRON_DISABLE_SECURITY_WARNINGS=true
            export ELECTRON_OZONE_PLATFORM_HINT=wayland

            # Glibc compatibility
            export NIX_LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronLibs}"
            export NIX_LD=${pkgs.glibc}/lib64/ld-linux-x86-64.so.2

            echo ""
            echo "🚀 sakti-code development environment"
            echo "   Node: $(node --version)"
            echo "   pnpm: $(pnpm --version)"
            echo "   Electron: ${pkgs.electron.version}"
            echo "   Glibc: ${pkgs.glibc.version}"
            echo "   Platform: wayland"
            echo ""
            echo "Available commands:"
            echo "   pnpm dev        - Start development server"
            echo "   pnpm build      - Build for production"
            echo "   pnpm typecheck  - Run TypeScript checks"
            echo ""
          '';
        };
      }
    );
}
