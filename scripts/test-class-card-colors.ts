import assert from 'node:assert/strict';
import { classCardColors } from '../src/utils/class-card-colors';

const rgb = (value: string): number[] => {
  const [h,s,l] = value.match(/[\d.]+/g)!.map(Number);
  const a = s / 100 * Math.min(l/100, 1-l/100);
  return [0,8,4].map(n => {
    const k=(n+h/30)%12;
    return l/100-a*Math.max(-1,Math.min(k-3,9-k,1));
  });
};
const hex = (value: string) => value.match(/\w\w/g)!.map(v=>parseInt(v,16)/255);
const luminance=(v:number[])=>v.map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);
const contrast=(a:number[],b:number[])=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const branch=(n:number):string=>n<26?String.fromCharCode(65+n):branch(Math.floor(n/26)-1)+String.fromCharCode(65+n%26);
const styles=(name:string)=>classCardColors(name) as Record<string,string>;
const expectedHues={5:[131,161],6:[201,231],7:[13,43],8:[262,292]};
let minimum=Infinity;
for(let grade=1;grade<=20;grade++) {
  const before=Array.from({length:1000},(_,i)=>[`${grade}-${branch(i)}`,styles(`${grade}-${branch(i)}`)] as const);
  assert.equal(new Set(before.map(([,s])=>s['--class-light-bg'])).size,1000,'no finite branch palette');
  for(const[name,s]of [...before].reverse()) {
    assert.deepEqual(styles(name),s,'list order must not affect color');
    for(const theme of ['light','dark']) {
      const text=hex(theme==='light'?'172b36':'f1f5f9'),count=hex(theme==='light'?'20313b':'dbe6ef');
      for(const surface of ['bg','end','hover']) {
        const background=rgb(s[`--class-${theme}-${surface}`]);
        for(const foreground of [text,count]) {const ratio=contrast(foreground,background);minimum=Math.min(minimum,ratio);assert(ratio>=4.5,`${name} ${theme} ${surface}`);}
        assert(contrast(rgb(s[`--class-${theme}-accent`]),background)>=3,'border/selection contrast');
      }
      assert(contrast(rgb(s[`--class-${theme}-accent`]),rgb(s[`--class-${theme}-icon`]))>=4.5,'icon contrast');
    }
    if(grade in expectedHues) {const h=Number(s['--class-light-bg'].match(/[\d.]+/)![0]);const[min,max]=expectedHues[grade as keyof typeof expectedHues];assert(h>=min&&h<=max);}
  }
  assert.deepEqual(styles(`${grade}-A`),before[0][1],'adding a later branch must not reassign existing colors');
}
assert.deepEqual(styles(' 5/a '),styles('5-A'));
assert.deepEqual(styles('5-ç'),styles('5-Ç'));
assert.deepEqual(styles('5/ÖZEL A'),styles('5-ÖZEL A'));
assert.deepEqual(styles('5 ÖZEL A'),styles('5-ÖZEL A'));
assert.deepEqual(styles('8-A\u0308'),styles('8-Ä'));
assert.notDeepEqual(styles('ANA SINIFI'),styles('HAZIRLIK'));
assert.deepEqual(classCardColors('anything',true),classCardColors('other',true));
console.log(`Class card colors PASS: 20 levels × 1000 branches, stable order-independent mapping, Unicode normalization, four required hue families and light/dark normal/hover surfaces. Minimum text contrast ${minimum.toFixed(2)}:1.`);
