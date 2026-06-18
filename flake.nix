{
  description = "VibeDiff - A local Git diff viewer with Go backend and React frontend";

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
          buildInputs = with pkgs; [
            go
            gopls
            golangci-lint
            nodejs
            go-task
            entr
          ];

          shellHook = ''
            echo "Dev: task dev  ->  http://localhost:5173"
          '';
        };
      }
    );
}
