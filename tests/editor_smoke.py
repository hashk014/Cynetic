"""Exercise the authoring workflow with a browser and a stub for the desktop file picker."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
d=json.loads((root/'projects/Cantilever.cynetic').read_text(encoding='utf-8-sig'))
old=json.loads((root/'plate/Saltos.cinetique').read_text(encoding='utf-8-sig'))
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={"width":1280,"height":848})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script('window.documents='+json.dumps({'flexSession':{'preset':d},'saltosPreset':old})+''';
       window.ipc={postMessage(raw){
         const {id,op,data}=JSON.parse(raw);
         if(op==="simulate")return;
         if(op==="save")window.saved=structuredClone(data);
         queueMicrotask(()=>window.nativeReply(id,true,op==="save"?"test.cynetic":window.documents[op]??null));
       }};''')
    page.goto((root/'ui/index.html').as_uri())
    page.locator('#fx-canvas').wait_for(state='visible')
    def click(s): page.locator('#fx-'+s).click()
    def pos(x,y):
        rect=page.locator('#fx-canvas').bounding_box()
        scale=min(rect['width']/1080,rect['height']/720)
        return rect['x']+(rect['width']-1080*scale)/2+x*scale,rect['y']+(rect['height']-720*scale)/2+y*scale
    click('menu');click('new')
    page.wait_for_function("!Object.values(JSON.parse(localStorage.getItem('cynetic-flex-v1')).parts).some(Boolean)")
    for part,xy in [('support',(320,110)),('rail',(670,530)),('clamp',(320,320)),('beam',(390,480)),('bob',(390,480)),('block',(532,498))]:
        click(part);page.mouse.click(*pos(*xy))
    click('next');click('next')
    page.mouse.move(*pos(390,480));page.mouse.down();page.mouse.move(*pos(420,440),steps=5);page.mouse.up()
    click('key');click('vectors')
    click('play');page.wait_for_timeout(180);click('play')
    page.keyboard.press('Control+s')
    page.wait_for_function('window.saved?.tracks.beam.length===2')
    saved=page.evaluate('window.saved')
    assert all(saved['parts'].values()) and saved['vectors'] and [round(v,2) for v in saved['tracks']['beam'][1][:3]]==[2,100,330], saved
    page.locator('#fx-menu').click();click('undo');assert page.locator('#fx-vectors').get_attribute('aria-pressed')=='false'
    page.locator('#fx-menu').click();click('redo');assert page.locator('#fx-vectors').get_attribute('aria-pressed')=='true'
    assert not errors, errors
    print("scratch, six parts, drag at frame 2, key, vectors, playback, save and undo/redo passed")
    browser.close()
