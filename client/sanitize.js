import { parse } from '/vendor/acorn.mjs';
import { ALLOWED_HANDLERS } from './handlers.js';

// Legacy screens generate HTML. Sanitize every insertion and reject injected JavaScript.
const functions = new Set([...ALLOWED_HANDLERS,'parseFloat','parseInt','gcClass','updMed']);
export function safeHandler(code) {
  try {
    const ast=parse(code,{ecmaVersion:2022});
    let valid=true;
    if(ast.body.length>1 && !/^event\.stopPropagation\(\);delSlot\('[^']*'\)$/.test(code) && !["this.className=gcClass(parseFloat(this.value));updMed()","salPopupDia=null;renderSalCal()"].includes(code)) return false;
    const visit=node => {
      if (!node || typeof node!=='object') return;
      if (['NewExpression','FunctionExpression','ArrowFunctionExpression','UpdateExpression','TaggedTemplateExpression','TemplateLiteral','AwaitExpression','ImportExpression','VariableDeclaration','ThrowStatement','WhileStatement','ForStatement','ObjectExpression','ArrayExpression'].includes(node.type)) valid=false;
      if (node.type==='MemberExpression') {
        if (node.computed && !(node.property.type==='Literal' && Number.isInteger(node.property.value))) valid=false;
        if (!node.computed && ['constructor','prototype','__proto__','innerHTML','outerHTML','src','href','cookie','write','assign','fetch','eval'].includes(node.property.name)) valid=false;
      }
      if (node.type==='CallExpression') {
        const c=node.callee;
        if (c.type==='Identifier') {
          if (!functions.has(c.name)) valid=false;
          for(const argument of node.arguments) if(!['Literal','ThisExpression','MemberExpression','Identifier','UnaryExpression'].includes(argument.type) && !(argument.type==='CallExpression' && argument.callee.type==='Identifier' && ['parseFloat','parseInt'].includes(argument.callee.name))) valid=false;
        }
        else if (c.type==='MemberExpression' && !c.computed) {
          const allowed={event:['preventDefault','stopPropagation'],document:['getElementById'],location:['reload'],window:['print'],Math:['min','max']};
          if (c.object.type!=='Identifier' || !allowed[c.object.name]?.includes(c.property.name)) {
            // Only the static restore-file picker may invoke an element method.
            if (!(c.property.name==='click' && code==="document.getElementById('restoreFile').click()")) valid=false;
          }
        } else valid=false;
      }
      if (node.type==='AssignmentExpression') {
        const left=node.left;
        if (left.type==='Identifier') {if(left.name!=='salPopupDia') valid=false;}
        else if (left.type!=='MemberExpression' || left.computed || !['value','checked','className','label','descanso'].includes(left.property.name)) valid=false;
      }
      for (const [key,value] of Object.entries(node)) if (!['start','end'].includes(key)) {
        if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value==='object') visit(value);
      }
    };
    visit(ast);return valid;
  } catch {return false;}
}
const purifier=window.DOMPurify;
if (!purifier) throw new Error('No se ha podido cargar la protección HTML.');
purifier.addHook('uponSanitizeAttribute',(_node,data) => {
  if (data.attrName.startsWith('on')) {
    data.keepAttr=['onclick','onchange','oninput','onkeydown'].includes(data.attrName) && safeHandler(data.attrValue);
    if(data.keepAttr) data.forceKeepAttr=true;
  }
});
export const cleanHTML = (html, context) => {
  const config={ADD_ATTR:['target'],FORBID_TAGS:['script','iframe','object','embed','svg','math'],FORBID_ATTR:['srcdoc']};
  const tag=context?.tagName?.toLowerCase();
  if (['tbody','thead','tfoot','tr','table'].includes(tag)) {
    const wrapped=tag==='table' ? `<table>${html}</table>` : tag==='tr' ? `<table><tbody><tr>${html}</tr></tbody></table>` : `<table><${tag}>${html}</${tag}></table>`;
    const clean=purifier.sanitize(wrapped,{...config,RETURN_DOM:true});
    return clean.querySelector(tag)?.innerHTML || '';
  }
  return purifier.sanitize(String(html),config);
};
const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
Object.defineProperty(Element.prototype,'innerHTML',{...descriptor,set(value){descriptor.set.call(this,cleanHTML(value,this));}});
const insert=Element.prototype.insertAdjacentHTML;
Element.prototype.insertAdjacentHTML=function(position,html){return insert.call(this,position,cleanHTML(html));};
