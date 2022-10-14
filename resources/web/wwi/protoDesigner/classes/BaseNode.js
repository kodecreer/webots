'use strict';

import {FieldModel} from './FieldModel.js';
import {generateProtoId, generateParameterId} from './utility/utility.js';
//import Parameter from './Parameter.js';
import Tokenizer from './Tokenizer.js';
import ProtoNode from './ProtoNode.js';
import { VRML, typeFactory, SFNode } from './Vrml.js';
import { createNode } from './NodeFactory.js';

export default class BaseNode {
  constructor(name, externProtos) {
    this.id = generateProtoId(); // TODO: rename
    this.name = name;
    this.externProtos = externProtos;
    if (typeof FieldModel[name] === 'undefined')
      throw new Error(`${name} is not a supported BaseNode.`);

    this.model = FieldModel[name];
    console.log('CREATING BASE NODE ' + this.name)

    this.parameters = new Map();
    const fields = FieldModel[name]['supported'];
    for (const parameterName of Object.keys(fields)) {
      //const parameter = new Parameter(this, generateParameterId(), parameterName, fields[parameterName], false)
      const parameter = typeFactory(fields[parameterName]);
      this.parameters.set(parameterName, parameter);
    }

    this.xml = document.implementation.createDocument('', '', null)
  }

  configureNodeFromTokenizer(tokenizer) {
    console.log('configure base node from tokenizer')
    //if (tokenizer.peekWord() === '{')
    tokenizer.skipToken('{');

    while (tokenizer.peekWord() !== '}') {
      const fieldName = tokenizer.nextWord();
      for (const [parameterName, parameter] of this.parameters) {
        if (fieldName === parameterName) {
          console.log('configuring ' + fieldName);

          if (tokenizer.peekWord() === 'IS') {
            throw new Error('TODO: handle IS')
          } else if (tokenizer.peekWord() === 'DEF') {
            throw new Error('TODO: handle DEF')
          } else if (tokenizer.peekWord() === 'USE') {
            throw new Error('TODO: handle USE')
          } else {
            if (parameter instanceof SFNode) {
              const node = createNode(tokenizer, this.externProtos);
              parameter.setValue(node);
            } else
              parameter.setValueFromTokenizer(tokenizer);

            console.log('> value set to ', parameter.value)
          }

        }
      }
    }

    tokenizer.skipToken('}');
  }

  toX3d() {
    // DOES BASENODE NEED this.value? OR IT'S END OF THE LINE?
    //if (typeof this.value === 'undefined')
    //  return;

    let nodeElement = this.xml.createElement(this.name);
    console.log('ENCODE ' + this.name)
    for(const [parameterName, parameter] of this.parameters) {
      console.log('ENCODE ' +  parameterName + ' ? ', typeof parameter.value !== 'undefined');
      if (typeof parameter.value === 'undefined')
        continue;

      if (parameter.value instanceof BaseNode || parameter.value instanceof ProtoNode) {
        //console.log(parameter.value.toX3dString())
        const subNode = parameter.value.toX3d();
        console.log(subNode)
        if (typeof subNode !== 'undefined')
          nodeElement.appendChild(subNode);
      } else {
        console.log(parameter.toX3d())
        nodeElement.setAttribute(parameterName, parameter.toX3d());
      }
    }

    this.xml.appendChild(nodeElement);
    console.log(new XMLSerializer().serializeToString(this.xml));

    return nodeElement;
  }

  toX3dString() {
    return new XMLSerializer().serializeToString(this.toX3d());
  }

  clone() {
    let copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    copy.id = generateProtoId();
    return copy;
  }
}

export { BaseNode };