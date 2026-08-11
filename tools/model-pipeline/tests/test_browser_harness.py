import subprocess
from pathlib import Path


ROOT = Path(__file__).parents[3]
PORT_MODULE = ROOT / "tools" / "model-pipeline" / "browser" / "port.mjs"


def test_browser_server_port_defaults_and_accepts_override() -> None:
    script = f"""
      import {{ parsePort }} from {PORT_MODULE.as_uri()!r};
      console.log(JSON.stringify([
        parsePort(['node', 'serve.mjs']),
        parsePort(['node', 'serve.mjs', '--port', '4100'])
      ]));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "[49786,4100]"
