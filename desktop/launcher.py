"""Windows launcher. Bundled Node serves the same UI and matching logic offline."""
import json
import os
import pathlib
import subprocess
import sys
import ctypes
import webbrowser

def main():
    bundle = pathlib.Path(getattr(sys, '_MEIPASS', pathlib.Path(__file__).resolve().parent.parent))
    data = pathlib.Path(os.environ.get('LOCALAPPDATA', str(pathlib.Path.home()))) / 'DasiNanum'
    data.mkdir(parents=True, exist_ok=True)
    log = open(data / 'app.log', 'a', encoding='utf-8')
    command = [str(bundle / 'runtime' / 'node.exe'), str(bundle / 'desktop-build' / 'server.mjs'), str(bundle / 'desktop-build' / 'static'), str(data)]
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=log, text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        line = child.stdout.readline()
        if not line:
            raise RuntimeError('앱을 시작하지 못했습니다. ' + str(data / 'app.log') + ' 파일을 확인해 주세요.')
        url = json.loads(line)['url']
        if '--self-test' in sys.argv:
            from urllib.request import urlopen
            with urlopen(url + '/api/workspace', timeout=10) as response:
                assert len(json.load(response)['state']['items']) == 6
            return
        webbrowser.open(url)
        ctypes.windll.user32.MessageBoxW(0, '브라우저에서 나눔 앱을 사용하고 있습니다.\n\n앱 사용을 마치면 [확인]을 눌러 종료하세요.\n\n앱 주소: ' + url, '다시, 나눔 실행 중', 0x40)
    except Exception as error:
        if '--self-test' in sys.argv:
            log.write(str(error) + '\n')
            sys.exit(1)
        ctypes.windll.user32.MessageBoxW(0, str(error), '다시, 나눔', 0x10)
    finally:
        child.terminate()
        child.wait(timeout=10)
        log.close()

if __name__ == '__main__':
    main()
