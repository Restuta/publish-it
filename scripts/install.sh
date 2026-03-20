#!/bin/sh
set -e

REPO="Restuta/pubmd"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
BINARY_NAME="pubmd"

main() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$OS" in
    darwin) OS="darwin" ;;
    linux) OS="linux" ;;
    *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
  esac

  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac

  TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)

  if [ -z "$TAG" ]; then
    echo "Could not determine latest release." >&2
    exit 1
  fi

  URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY_NAME}-${OS}-${ARCH}"
  TARGET="${INSTALL_DIR}/${BINARY_NAME}"

  echo "Installing ${BINARY_NAME} ${TAG} (${OS}/${ARCH})..."
  mkdir -p "$INSTALL_DIR"

  if [ -w "$INSTALL_DIR" ]; then
    curl -fsSL "$URL" -o "$TARGET"
    chmod +x "$TARGET"
  else
    echo "Need sudo to install to ${INSTALL_DIR}"
    sudo mkdir -p "$INSTALL_DIR"
    sudo curl -fsSL "$URL" -o "$TARGET"
    sudo chmod +x "$TARGET"
  fi

  echo "Installed ${BINARY_NAME} to ${TARGET}"
  "$TARGET" --help

  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      echo ""
      echo "Add ${INSTALL_DIR} to your PATH to run ${BINARY_NAME} from any shell."
      echo "Example for zsh:"
      echo "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc"
      echo "  source ~/.zshrc"
      ;;
  esac
}

main
