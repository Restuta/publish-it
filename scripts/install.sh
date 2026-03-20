#!/bin/sh
set -e

REPO="Restuta/pubmd"
INSTALL_DIR="/usr/local/bin"
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

  echo "Installing ${BINARY_NAME} ${TAG} (${OS}/${ARCH})..."

  if [ -w "$INSTALL_DIR" ]; then
    curl -fsSL "$URL" -o "${INSTALL_DIR}/${BINARY_NAME}"
    chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
  else
    echo "Need sudo to install to ${INSTALL_DIR}"
    sudo curl -fsSL "$URL" -o "${INSTALL_DIR}/${BINARY_NAME}"
    sudo chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
  fi

  echo "Installed ${BINARY_NAME} to ${INSTALL_DIR}/${BINARY_NAME}"
  "${INSTALL_DIR}/${BINARY_NAME}" help
}

main
