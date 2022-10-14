'use strict';

import {generateParameterId, generateProtoId} from './utility/utility.js';

import TemplateEngine  from './TemplateEngine.js';
import Parameter from './Parameter.js';
import Tokenizer from './Tokenizer.js';
import BaseNode from './BaseNode.js';
import { FieldModel } from './FieldModel.js'; // TODO: merge in BaseNode?
import { VRML } from './Vrml.js';
import { createNode, createPrototype } from './NodeFactory.js';

export default class ProtoNode {
  constructor(protoText, protoUrl) {
    this.id = generateProtoId();
    this.url = protoUrl;
    this.name = this.url.slice(this.url.lastIndexOf('/') + 1).replace('.proto', '')
    console.log('CREATING PROTO ' + this.name)
    this.externProtos = new Map();

    this.xml = document.implementation.createDocument('', '', null)
    // to generate: <Shape castShadows="true"><PBRAppearance baseColor="1 0 0"/></Shape>
    /*
    const xml = document.implementation.createDocument('', '', null)
    const shapeNode = xml.createElement('Shape');
    shapeNode.setAttribute('castShadows', 'true')
    const pbrNode = xml.createElement('PBRAppearance')
    pbrNode.setAttribute('baseColor', '1 0 0');
    shapeNode.appendChild(pbrNode)
    xml.appendChild(shapeNode);
    console.log(new XMLSerializer().serializeToString(xml))
    */

    // the value of a PROTO is its base-type
    this.value = undefined;

    this.isTemplate = protoText.search('template language: javascript') !== -1;
    if (this.isTemplate) {
      console.log('PROTO is a template!');
      this.templateEngine = new TemplateEngine();
    }

    // change all relative paths to remote ones
    const re = /\"(?:[^\"]*)\.(jpe?g|png|hdr|obj|stl|dae|wav|mp3)\"/g;
    let result;
    while((result = re.exec(protoText)) !== null) {
      // console.log(result)
      protoText = protoText.replace(result[0], '\"' + combinePaths(result[0].slice(1, -1), this.url) + '\"');
    }

    // raw proto body text must be kept in case the template needs to be regenerated
    const indexBeginBody = protoText.search(/(?<=\]\s*\n*\r*)({)/g);
    this.rawBody = protoText.substring(indexBeginBody);
    if (!this.isTemplate)
      this.protoBody = this.rawBody; // body already VRML compliant

    // head only needs to be parsed once and persists through regenerations
    // TODO: rename interface/parameters
    const indexBeginHead = protoText.search(/(?<=\n|\n\r)(PROTO)(?=\s\w+\s\[)/g); // proto header
    this.rawHead = protoText.substring(indexBeginHead, indexBeginBody);

    // defines tags and EXTERNPROTO, persists through regenerations
    this.rawHeader = protoText.substring(0, indexBeginHead);

    // get EXTERNPROTO
    this.promises = [];
    const lines = this.rawHeader.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (line.indexOf('EXTERNPROTO') !== -1) {
        // get only the text after 'EXTERNPROTO' for the single line
        line = line.split('EXTERNPROTO')[1].trim();
        let address = line.replaceAll('"', '');
        let protoName = address.split('/').pop().replace('.proto', '');
        if (address.startsWith('webots://'))
          address = 'https://raw.githubusercontent.com/cyberbotics/webots/R2022b/' + address.substring(9);
        else
          address = combinePaths(address, this.url)

        this.externProtos.set(protoName, address);
        this.promises.push(this.getExternProto(address));
      }
    }
  };

  getExternProto(protoUrl) {
    return new Promise((resolve, reject) => {
      const xmlhttp = new XMLHttpRequest();
      xmlhttp.open('GET', protoUrl, true);
      xmlhttp.overrideMimeType('plain/text');
      xmlhttp.onreadystatechange = async() => {
        if (xmlhttp.readyState === 4 && (xmlhttp.status === 200 || xmlhttp.status === 0)) // Some browsers return HTTP Status 0 when using non-http protocol (for file://)
          resolve(xmlhttp.responseText);
      };
      xmlhttp.send();
    }).then(text => {
      console.log('downloaded ' + protoUrl + ', generating prototype');
      return createPrototype(text, protoUrl);
    });
  }

  async fetch() {
    return Promise.all(this.promises).then(async () => {
      // parse header and map each parameter entry
      console.log(this.name + ': all EXTERNPROTO promises have been resolved')
      this.parameters = new Map();
      await this.parseHead();
    });
  }


  clone() {
    let copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    copy.id = generateProtoId();
    return copy;
  }

  async parseHead() {
    console.log('PARSE HEAD OF ' + this.name)
    const headTokenizer = new Tokenizer(this.rawHead);
    headTokenizer.tokenize();

    const tokens = headTokenizer.tokens();
    //console.log('Header Tokens: \n', tokens);

    // build parameter list
    headTokenizer.skipToken('PROTO');
    this.protoName = headTokenizer.nextWord();

    while (!headTokenizer.peekToken().isEof()) {
      const token = headTokenizer.nextToken();
      let nextToken = headTokenizer.peekToken();

      if (token.isKeyword() && nextToken.isPunctuation()) {
        if (nextToken.word() === '{'){
          // TODO: field restrictions are not supported yet, consume the tokens
          headTokenizer.consumeTokensByType(VRML.SFNode);
          nextToken = headTokenizer.peekToken(); // update upcoming token reference after consumption
        }
      }

      if (token.isKeyword() && nextToken.isIdentifier()) {
        const parameterName = nextToken.word(); // actual name used in the header (i.e value after an IS)
        const parameterType = token.fieldTypeFromVrml();
        const isRegenerator = this.isTemplate ? this.isTemplateRegenerator(parameterName) : false;
        headTokenizer.nextToken(); // consume the parameter name token

        console.log('VRML PARAMETER ' + parameterName + ', TYPE: ' + parameterType);

        const parameterId = generateParameterId();
        const parameter = new Parameter(this, parameterId, parameterName, parameterType, isRegenerator)

        // TODO: should be moved elsewhere? (to handle MF etc)
        const value = this.encodeParameter(parameterType, headTokenizer);
        if (value instanceof Proto) {
          value.configureNodeFromTokenizer(headTokenizer, undefined, value);
          parameter.setDefaultValue(value);
          parameter.setValue(value.clone());
        } else if (parameterType % 2 === 0) {
          throw new Error('TODO: MF not handled yet')
        } else {
          parameter.setDefaultValue(value);
          parameter.setValue(typeof value === 'undefined' ? undefined : JSON.parse(JSON.stringify(value)));
        }

        console.log('Parameter isDefaultValue? ', parameter.isDefaultValue())
        this.parameters.set(parameterName, parameter);
      }
    }
  };

  parseBody() {
    this.clearReferences();
    // note: if not a template, the body is already pure VRML
    if (this.isTemplate)
      this.regenerateBodyVrml(); // overwrites this.protoBody with a purely VRML compliant body

    // tokenize body
    const bodyTokenizer = new Tokenizer(this.protoBody);
    bodyTokenizer.tokenize();

    // skip bracket opening the PROTO body
    bodyTokenizer.skipToken('{'); // TODO: move elsewhere or remove from tokenizer

    const baseType = bodyTokenizer.peekWord();
    let protoUrl;
    if (typeof FieldModel[baseType] === 'undefined')
      protoUrl = this.externProtos.get(baseType); // it's a derived PROTO

    this.value = createNode(bodyTokenizer, this.externProtos);
    //this.x3d = value.toX3d()
    //console.log(this.x3d)
    // generate x3d from VRML

  };

  toX3d() {
    if (typeof this.value === 'undefined')
      return;

    let nodeElement = this.xml.createElement(this.value.name);
    console.log('ENCODE ' + this.value.name)
    for(const [parameterName, parameter] of this.value.parameters) {
      console.log('ENCODE ' +  parameterName + ' ? ', typeof parameter.value !== 'undefined');
      if (typeof parameter.value === 'undefined')
        continue;

      if (parameter.value instanceof BaseNode || parameter.value instanceof ProtoNode) {
        //console.log('encode node ' + parameter.value.name)
        const subNode = parameter.value.toX3d();
        if (typeof subNode !== 'undefined')
          nodeElement.appendChild(subNode);
      } else {
        console.log(parameter.toX3d())
        nodeElement.setAttribute(parameterName, parameter.toX3d());
      }
    }

    this.xml.appendChild(nodeElement);
    console.log('RESULT:', new XMLSerializer().serializeToString(this.xml));

    return nodeElement;
  }

  toX3dString() {
    return new XMLSerializer().serializeToString(this.toX3d());
  }

  // TODO: can be moved to parameter?
  isTemplateRegenerator(parameterName) {
    return this.rawBody.search('fields.' + parameterName + '.') !== -1;
  };

  regenerateBodyVrml() {
    this.encodeFieldsForTemplateEngine(); // make current proto parameters in a format compliant to templating rules

    if(typeof this.templateEngine === 'undefined')
      throw new Error('Regeneration was called but the template engine is not defined (i.e this.isTemplate is false)');

    this.protoBody = this.templateEngine.generateVrml(this.encodedFields, this.rawBody);
    // console.log('Regenerated Proto Body:\n' + this.protoBody);
  };

  clearReferences() {
    //for (const parameter of this.parameters.values()) {
    //  parameter.nodeRefs = [];
    //  parameter.refNames = [];
    //}
  };
};


function combinePaths(url, parentUrl) {
  if (url.startsWith('http://') || url.startsWith('https://'))
    return url;  // url is already resolved

  let newUrl;
  if (parentUrl.startsWith('http://' || url.startsWith('https://')))
    newUrl = new URL(url, parentUrl.slice(0, parentUrl.lastIndexOf('/') + 1)).href;
  else
    newUrl = parentUrl.slice(0, parentUrl.lastIndexOf('/') + 1) + url;

  // console.log('FROM >' + url + '< AND >' + parentUrl + "< === " + newUrl);
  return newUrl;
}

export { ProtoNode, combinePaths };
