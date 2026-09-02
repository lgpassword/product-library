# -*- coding: utf-8 -*-
"""统一启动入口：先检查 8000 端口是否已被占用，避免重复启动报端口冲突错误"""
import socket
import sys
import os


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
    if port_in_use(PORT):
        # 服务已在运行，静默退出（不报错、不弹窗）
        print(f"服务已在运行，请直接访问 http://127.0.0.1:{PORT}")
        sys.exit(0)
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    import uvicorn
    from app import app
    uvicorn.run(app, host="0.0.0.0", port=PORT)
