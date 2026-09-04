# -*- coding: utf-8 -*-
"""统一启动入口:检查 8000 端口 → 启动 uvicorn。
所有启动情况(成功/端口占用/异常)都会写入同目录 autostart.log,便于排查开机自启问题。
"""
import os
import sys
import socket
import traceback
from datetime import datetime

LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "autostart.log")


def _log(msg):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        pass


def port_in_use(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("0.0.0.0", port))
        s.close()
        return False
    except OSError:
        return True


if __name__ == "__main__":
    PORT = 8000
    _log(f"===== 启动入口被调用 (argv={sys.argv}) =====")

    # 关键:pythonw.exe 无控制台,sys.stdout/stderr 为 None,
    # uvicorn 初始化日志时会调用 sys.stdout.isatty() 导致 AttributeError 崩溃。
    # 这里把标准输出/错误重定向到日志文件,保证无窗口环境下也能正常启动。
    try:
        if sys.stdout is None or sys.stderr is None:
            _flog = open(LOG_PATH, "a", encoding="utf-8")
            if sys.stdout is None:
                sys.stdout = _flog
            if sys.stderr is None:
                sys.stderr = _flog
            _log("已重定向 stdout/stderr 到日志(pythonw 无控制台模式)")
    except Exception:
        pass

    try:
        if port_in_use(PORT):
            _log(f"端口 {PORT} 已被占用,判定服务已在运行,本次静默退出(exit 0)")
            print(f"服务已在运行，请直接访问 http://127.0.0.1:{PORT}")
            sys.exit(0)
        _log(f"端口 {PORT} 空闲,开始启动 uvicorn...")
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        import uvicorn
        from app import app
        _log("模块导入成功,uvicorn.run 开始监听")
        uvicorn.run(app, host="0.0.0.0", port=PORT)
    except SystemExit:
        raise
    except Exception:
        _log("启动异常:\n" + traceback.format_exc())
        raise
