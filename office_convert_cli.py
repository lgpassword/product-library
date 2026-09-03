# -*- coding: utf-8 -*-
"""office_convert_cli.py — 由产品库主服务以子进程方式调用,把 Office 文档保真转 PDF。

用法: python office_convert_cli.py <src> <dst.pdf> <ext>
ext ∈ {.docx,.doc,.xlsx,.xls,.pptx,.ppt}
成功退出码 0;失败打印 ERR 并退出 1。父进程可用超时杀本进程,不会拖死主服务。
"""
import os
import sys
import traceback

WORD_EXTS = {".docx", ".doc"}
EXCEL_EXTS = {".xlsx", ".xlsm", ".xls"}
PPT_EXTS = {".pptx", ".ppt"}


def main():
    src, dst, ext = sys.argv[1], sys.argv[2], sys.argv[3].lower()
    app = None
    try:
        if ext in WORD_EXTS:
            import win32com.client as wc
            app = wc.DispatchEx("Word.Application")
            try:
                app.Visible = False
                app.DisplayAlerts = 0  # wdAlertsNone,避免 VBA/打开错误阻塞 COM
            except Exception:
                pass
            doc = app.Documents.Open(src, ReadOnly=True)
            try:
                doc.ExportAsFixedFormat(dst, 17)  # wdExportFormatPDF
            finally:
                try:
                    doc.Close(False)
                except Exception:
                    pass
        elif ext in EXCEL_EXTS:
            import win32com.client as wc
            app = wc.DispatchEx("Excel.Application")
            try:
                app.Visible = False
                app.DisplayAlerts = 0  # 抑制宏错误/确认对话框
            except Exception:
                pass
            wb = app.Workbooks.Open(src, ReadOnly=True)
            try:
                wb.ExportAsFixedFormat(0, dst)  # xlTypePDF
            finally:
                try:
                    wb.Close(False)
                except Exception:
                    pass
        elif ext in PPT_EXTS:
            # PowerPoint 2010 的 COM PDF 导出不可靠 → 使用 WPS 演示
            import win32com.client as wc
            app = wc.DispatchEx("Kwpp.Application")
            try:
                app.Visible = False
            except Exception:
                pass
            prs = app.Presentations.Open(src)
            try:
                prs.SaveAs(dst, 32)  # ppSaveAsPDF
            finally:
                try:
                    prs.Close()
                except Exception:
                    pass
        else:
            raise ValueError("不支持的 Office 类型: " + ext)
        if not os.path.exists(dst) or os.path.getsize(dst) < 1000:
            raise RuntimeError("转换后未生成 PDF 文件")
        print("OK", dst)
        sys.exit(0)
    except SystemExit:
        raise
    except Exception:
        print("ERR", repr(traceback.format_exc(limit=2)))
        sys.exit(1)
    finally:
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass


if __name__ == "__main__":
    main()
