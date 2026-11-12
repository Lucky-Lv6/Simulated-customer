# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import copy_metadata

datas = [('frontend/dist', 'frontend_dist'), ('backend/prompts', 'prompts'), ('backend/knowledge', 'knowledge'), ('backend/.env.example', '.'), ('README.md', '.')]
datas += copy_metadata('openai')
datas += copy_metadata('httpx')
datas += copy_metadata('pydantic')
datas += copy_metadata('fastapi')
datas += copy_metadata('starlette')
datas += copy_metadata('websockets')


a = Analysis(
    ['backend/app.py'],
    pathex=['backend'],
    binaries=[],
    datas=datas,
    hiddenimports=['uvicorn.logging', 'uvicorn.loops.auto', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan.on', 'websockets.legacy', 'websockets.legacy.server', 'multipart', 'python_multipart'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='FDE-Customer-Agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
