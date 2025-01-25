# Create a folder
mkdir actions-runner && cd actions-runner
# Download the latest runner package
curl -o actions-runner-osx-x64-2.321.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-osx-x64-2.321.0.tar.gz
# Optional: Validate the hash
echo "b2c91416b3e4d579ae69fc2c381fc50dbda13f1b3fcc283187e2c75d1b173072  actions-runner-osx-x64-2.321.0.tar.gz" | shasum -a 256 -c
# Extract the installer
tar xzf ./actions-runner-osx-x64-2.321.0.tar.gz

# Create the runner and start the configuration experience
./config.sh --url https://github.com/snteks/homelab --token AJENUCWCMKKOGNFYNXL477DHSUTQO
# Last step, run it!
./run.sh

# Use this YAML in your workflow file for each job
runs-on: self-hosted
