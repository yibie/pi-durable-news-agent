# Durable News Agent. Recipes live in just/<group>/mod.just; code lives in apps/ (the npm workspace root).
# Device recipes take an id from dna-network.yaml.
set dotenv-load := true
set shell := ["zsh", "-cu"]

# dna-server-api on port 4850
mod api 'just/api'

# The every minute tick and crontab
mod cron 'just/cron'

# Hub and Vue client on port 4851
mod browser 'just/browser'

# Terminal client
mod tui 'just/tui'

# The dna command
mod cli 'just/cli'

# Devices: this Mac, a Mac mini, any ssh box (dna-network.yaml)
mod net 'just/net'

# Unit, faux, ui and live suites
mod test 'just/test'

# Recipes spanning several apps
mod combos 'just/combos'

# List command groups
default:
    @just --list

# Install every workspace package (apps/ is the npm workspace root)
install:
    npm install --no-audit --no-fund
    npm run build -w @dna/argmap

# Types, lint, format and unit tests
check: test::unit
