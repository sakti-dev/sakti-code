{
  description = "sakti-code - Electron + SolidJS + Node (nub) dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # All runtime dependencies for Electron (proven set from sakti-code-old)
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

          # Graphics/OpenGL (provides libEGL.so.1, libGL.so.1, libGLESv2.so.2)
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

          # C++ runtime for native modules (better-sqlite3 / node-pty / tokenizers if used)
          gcc.cc.lib
          stdenv.cc.cc.lib
          stdenv.cc.cc

          # Additional dependencies for native modules
          zlib
          libgcc
        ];

        # native module build tools (node-gyp needs python + make to rebuild node-pty)
        nativeBuildTools = with pkgs; [ python3 gnumake pkg-config ];

      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            git
          ] ++ nativeBuildTools ++ electronLibs;

          shellHook = ''
            # Library paths — Electron's bundled Chromium needs these at runtime
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronLibs}:$LD_LIBRARY_PATH"
            export PATH="${pkgs.lib.makeBinPath ([ pkgs.git ] ++ nativeBuildTools)}:$PATH"

            # Locale
            export LOCALE_ARCHIVE="${pkgs.glibcLocales}/lib/locale/locale-archive"

            # Electron configuration
            export ELECTRON_DISABLE_SECURITY_WARNINGS=true
            export ELECTRON_OZONE_PLATFORM_HINT=wayland

            # Glibc compatibility (run nix-ld-style for downloaded binaries: electron, native .node)
            export NIX_LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronLibs}"
            export NIX_LD=${pkgs.glibc}/lib64/ld-linux-x86-64.so.2

            echo ""
            echo "🚀 sakti-code development environment"
            echo "   nub:      $(nub --version 2>/dev/null || echo 'n/a (install: https://nubjs.com)')"
            echo "   Node:     $(node --version 2>/dev/null || echo 'n/a')"
            echo "   Electron: (via node_modules — run: nub install)"
            echo "   Glibc:    ${pkgs.glibc.version}"
            echo ""
            echo "Available commands:"
            echo "   nub run dev:server             - Start the Hono server standalone (port 3001)"
            echo "   cd apps/desktop && nub run dev - Run the Electron app (HMR + embedded server)"
            echo "   nub run typecheck              - TypeScript checks"
            echo ""
          '';
        };
      }
    );
}
