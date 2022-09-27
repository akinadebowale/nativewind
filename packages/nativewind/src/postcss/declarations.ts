/* eslint-disable unicorn/no-lonely-if */
import { Block, CssNode, Declaration, walk, parse } from "css-tree";
import { Atom, StyleWithFunction, VariableValue } from "../style-sheet";
import { validProperties } from "./valid-styles";

import { TransformsStyle } from "react-native";
import { flatten } from "./flatten";

export type StylesAndTopics = Required<
  Pick<Atom, "styles" | "topics" | "variables">
>;

type InferArray<T> = T extends Array<infer K> ? K : never;
type Transform = InferArray<NonNullable<TransformsStyle["transform"]>>;

type StyleValue =
  | string
  | number
  | string[]
  | Transform
  | TransformsStyle["transform"]
  | StyleWithFunction
  | CssNode
  | undefined;

export function getDeclarations(block: Block) {
  const atom: StylesAndTopics = {
    styles: [],
    topics: [],
    variables: [],
  };

  walk(block, {
    visit: "Declaration",
    enter(node) {
      switch (node.property) {
        case "border":
          return border(atom, node);
        case "box-shadow":
          return boxShadow(atom, node);
        case "flex":
          return flex(atom, node);
        case "flex-flow":
          return flexFlow(atom, node);
        case "font":
          return font(atom, node);
        case "font-family":
          return fontFamily(atom, node);
        case "place-content":
          return placeContent(atom, node);
        case "text-decoration":
          return textDecoration(atom, node);
        case "text-decoration-line":
          return textDecorationLine(atom, node);
        case "text-shadow":
          return textShadow(atom, node);
        case "transform":
          return transform(atom, node);
        default: {
          if (node.value.type === "Raw") {
            if (node.property.startsWith("--")) {
              const ast = parse(node.value.value.trim(), { context: "value" });

              if (ast.type !== "Value") {
                return;
              }

              const value = parseStyleValue(ast.children.toArray()[0], []);
              if (typeof value === "object" && !("function" in value)) {
                return;
              }

              if (value !== undefined) {
                atom.variables.push({ [node.property]: value });
              }
            }
          } else {
            return pushStyle(
              atom,
              node.property,
              node.value.children.toArray()[0]
            );
          }
        }
      }
    },
  });

  return {
    ...atom,
    styles: flatten(atom.styles),
  };
}

function pushStyle(
  atom: StylesAndTopics,
  property: string,
  node?: StyleValue | null
) {
  if (!node) return;

  const topics: string[] = [];
  // This mutates topics, theres probably a better way to write this
  const value = parseStyleValue(node, topics);

  if (value === undefined || value === null) return;

  atom.topics ??= [];
  atom.topics.push(...topics);

  // To camelCase
  const styleProperty = property.replace(/-./g, (x) => x[1].toUpperCase());

  if (validProperties.has(styleProperty)) {
    atom.styles.push({
      [styleProperty]: value,
    });
  }
}

function parseStyleValue(
  node: StyleValue | null | undefined,
  topics: string[]
): StyleValue | StyleValue[] | undefined {
  if (!node) return;

  if (typeof node === "string") {
    const maybeNumber = Number.parseFloat(node);
    return Number.isNaN(maybeNumber) ? node : maybeNumber;
  }

  if (typeof node === "number") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((n) => parseStyleValue(n, topics)) as StyleValue[];
  }

  if ("function" in node) {
    return node;
  }

  if ("type" in node) {
    switch (node.type) {
      case "Identifier":
        return node.name;
      case "Number":
        return Number.parseFloat(node.value.toString());
      case "String":
        return node.value;
      case "Hash":
        return `#${node.value}`;
      case "Percentage":
        return `${node.value}%`;
      case "Dimension":
        switch (node.unit) {
          case "px":
            return Number.parseFloat(node.value.toString());
          case "vw":
          case "vh":
            return {
              function: node.unit,
              values: [Number.parseFloat(node.value.toString())],
            };
          default:
            return `${node.value}${node.unit}`;
        }
      case "Function":
        switch (node.name) {
          case "pixelRatio":
            return { function: "pixelRatio", values: [] };
          case "platformColor": {
            const children = node.children
              .toArray()
              .map((child) => parseStyleValue(child, topics))
              .filter((child) => Boolean(child));

            return {
              function: "platformColor",
              values: children as unknown as VariableValue[],
            };
          }
          case "var": {
            const children = node.children.toArray();
            const variableName = parseStyleValue(children[0], topics);

            if (typeof variableName !== "string") return [];

            const values: StyleWithFunction["values"] = [variableName];
            topics.push(variableName);

            if (children.length === 3) {
              const defaultChild = children[2];

              if (defaultChild.type === "Raw") {
                const ast = parse(defaultChild.value, {
                  context: "value",
                });

                if (ast.type === "Value") {
                  const defaultValue = parseStyleValue(
                    ast.children.toArray()[0],
                    []
                  );

                  if (typeof defaultValue === "object") {
                    if ("function" in defaultValue) {
                      values.push(defaultValue);
                    }
                  } else if (defaultValue) {
                    values.push(defaultValue);
                  }
                }
              }
            }

            return {
              function: "var",
              values,
            };
          }
          default: {
            const values = node.children.toArray().flatMap((child) => {
              return parseStyleValue(child, topics) ?? [];
            });

            const hasDynamicValues = values.some(
              (value) => typeof value === "object"
            );

            return hasDynamicValues
              ? {
                  function: "inbuilt",
                  values: [node.name, ...(values as string[])],
                }
              : `${node.name}(${values.join(", ")})`;
          }
        }
      default:
        return;
    }
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      return [key, parseStyleValue(value, topics)];
    })
  ) as unknown as Transform;
}

function border(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  const children = node.value.children.toArray();

  if (children.length === 1) {
    pushStyle(atom, "borderStyle", children[0]);
  }

  if (children.length === 2) {
    if (children[0].type === "Dimension") {
      /* width | style */
      pushStyle(atom, "borderWidth", children[0]);
    } else {
      /* style | color */
      pushStyle(atom, "borderStyle", children[0]);
      pushStyle(atom, "borderColor", children[1]);
    }
  }

  if (children.length === 3) {
    pushStyle(atom, "borderWidth", children[0]);
    pushStyle(atom, "borderStyle", children[1]);
    pushStyle(atom, "borderColor", children[2]);
  }
}

function boxShadow(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  let children = node.value.children.toArray();

  const operatorIndex = children.findIndex(
    (child) => child.type === "Operator"
  );

  if (operatorIndex > 0) {
    children = children.slice(operatorIndex);
  }

  /* Keyword values */
  if (children.length === 1) {
    const child = node.value.children.shift()?.data;

    switch (child?.type) {
      case "Identifier":
        return;
      default:
        pushStyle(atom, "borderStyle", children[0]);
    }
  }

  /* offset-x | offset-y | color */
  if (children.length === 3) {
    pushStyle(atom, "shadowOffset.width", children[0]);
    pushStyle(atom, "shadowOffset.height", children[1]);
    pushStyle(atom, "shadowColor", children[2]);
  }

  if (children.length === 4) {
    /* inset | offset-x | offset-y | color */
    if (children[0].type === "Identifier" && children[0].name === "inset") {
      return;
    }

    /* offset-x | offset-y | blur-radius | color */
    pushStyle(atom, "shadowOffset.width", children[0]);
    pushStyle(atom, "shadowOffset.height", children[1]);
    pushStyle(atom, "shadowRadius", children[2]);
    pushStyle(atom, "shadowColor", children[3]);
  }

  /* offset-x | offset-y | blur-radius | spread-radius | color */
  if (children.length === 5) {
    pushStyle(atom, "shadowOffset.width", children[0]);
    pushStyle(atom, "shadowOffset.height", children[1]);
    pushStyle(atom, "shadowRadius", children[3]);
    pushStyle(atom, "shadowColor", children[4]);
  }
}

function flex(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  const children = node.value.children.toArray();

  if (children.length === 1) {
    const firstChild = children[0];

    if (firstChild.type === "Identifier") {
      /* Keyword values */
      if (firstChild.name === "none") {
        pushStyle(atom, "flexGrow", 0);
        pushStyle(atom, "flexShrink", 0);
        pushStyle(atom, "flexBasis", "auto");
      } else if (firstChild.name === "auto" || firstChild.name === "initial") {
        pushStyle(atom, "flexGrow", 1);
        pushStyle(atom, "flexShrink", 1);
        pushStyle(atom, "flexBasis", "auto");
      } else {
        return;
      }
    } else if (firstChild.type === "Number") {
      /* One value, unit-less number: flex-grow */
      pushStyle(atom, "flexGrow", children[0]);
    } else {
      pushStyle(atom, "flexBasis", children[0]);
    }
  }

  if (children.length === 2) {
    const secondChild = children[1];

    if (secondChild.type === "Number") {
      /* flex-grow | flex-shrink */
      pushStyle(atom, "flexGrow", children[0]);
      pushStyle(atom, "flexShrink", children[1]);
    } else {
      /* flex-grow | flex-basis */
      pushStyle(atom, "flexGrow", children[0]);
      pushStyle(atom, "flexBasis", children[1]);
    }
  }

  /* flex-grow | flex-shrink | flex-basis */
  if (children.length === 3) {
    pushStyle(atom, "flexGrow", children[0]);
    pushStyle(atom, "flexShrink", children[1]);
    pushStyle(atom, "flexBasis", children[2]);
  }
}

function flexFlow(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  const children = node.value.children.toArray();

  if (children.length === 1) {
    const firstChild = children[0];

    if (firstChild.type === "Identifier") {
      if (
        firstChild.name === "row" ||
        firstChild.name === "column" ||
        firstChild.name === "row-reverse" ||
        firstChild.name === "column-reverse"
      ) {
        pushStyle(atom, "flexDirection", children[0]);
      } else if (
        firstChild.name === "wrap" ||
        firstChild.name === "nowrap" ||
        firstChild.name === "wrap-reverse"
      ) {
        pushStyle(atom, "flexWrap", children[0]);
      }
    }
  } else if (children.length === 2) {
    pushStyle(atom, "flexDirection", children[0]);
    pushStyle(atom, "flexWrap", children[1]);
  }
}

function font(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  const children = node.value.children.toArray();

  let fontStyle;
  let fontVariant: string[] | undefined;
  let fontWeight: string | number | undefined;
  let fontStretch: string | undefined;
  let fontSize: number | undefined;
  let lineHeight: string | undefined;
  let fontFamily: string | undefined;

  for (let i = 0; i < children.length; i++) {
    let child = children[i];
    if (!fontStyle) {
      if (child.type === "Identifier") {
        fontStyle = child.name;
        continue;
      } else {
        fontStyle = "normal";
      }
    }

    if (!fontVariant) {
      if (child.type === "Identifier" && child.name === "small-caps") {
        fontVariant = ["small-caps"];
        continue;
      } else {
        fontVariant = [];
      }
    }

    if (!fontWeight) {
      if (child.type === "Number") {
        fontWeight = child.value;
        continue;
      } else if (child.type === "Identifier" && child.name === "bold") {
        fontWeight = child.name;
        continue;
      }
    }

    if (!fontStretch && child.type === "Identifier") {
      fontStretch = "normal";
      continue;
    }

    if (!fontSize && child.type === "Number") {
      fontSize = Number.parseInt(child.value);
      continue;
    }

    if (!lineHeight) {
      if (child.type === "Operator" && child.value === "/") {
        i++;
        child = children[i];
        if (child.type === "Number") {
          lineHeight = child.value;
        }
      }
      continue;
    }

    if (!fontFamily) {
      if (child.type === "Identifier") {
        fontFamily = child.name;
        continue;
      } else {
        fontFamily = "normal";
      }
    }
  }

  if (fontStyle !== "normal") pushStyle(atom, "fontStyle", fontStyle);
  if (fontVariant && fontVariant?.length > 0) {
    pushStyle(atom, "fontVariant", fontVariant);
  }
  if (fontWeight) pushStyle(atom, "fontWeight", fontWeight);
  if (fontSize) pushStyle(atom, "fontSize", fontSize);
  if (lineHeight) pushStyle(atom, "lineHeight", lineHeight);
  if (fontFamily) pushStyle(atom, "fontFamily", fontFamily);
}

function fontFamily(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  const children = node.value.children.toArray();
  const firstChild = children[0];

  if (firstChild.type === "Identifier") {
    pushStyle(atom, "fontFamily", firstChild.name);
  } else if (firstChild.type === "String") {
    pushStyle(atom, "fontFamily", firstChild.value);
  }
}

function placeContent(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  const children = node.value.children.toArray();

  let alignContent: string | undefined;
  let justifyContent: string | undefined;

  for (const child of children) {
    if (alignContent === undefined) {
      if (child.type === "Identifier") {
        switch (child.name) {
          case "first":
          case "last":
          case "safe":
          case "unsafe":
            continue;
          case "baseline":
          case "space-evenly":
          case "stretch":
            alignContent = "";
            continue;
          case "start":
            alignContent = "flex-start";
            continue;
          case "end":
            alignContent = "flex-end";
            continue;
          default:
            alignContent = child.name;
        }
      }
    }

    if (justifyContent === undefined) {
      if (child.type === "Identifier") {
        switch (child.name) {
          case "safe":
          case "unsafe":
          case "normal":
          case "left":
          case "right":
          case "stretch":
          case "inherit":
          case "initial":
          case "revert":
          case "revert-layer":
          case "unset":
            continue;
          case "start":
            justifyContent = "flex-start";
            continue;
          case "end":
            justifyContent = "flex-end";
            continue;
          default:
            justifyContent = child.name;
        }
      }
    }
  }

  if (alignContent) pushStyle(atom, "alignContent", alignContent);
  if (justifyContent) pushStyle(atom, "justifyContent", justifyContent);
}

function textDecoration(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  let textDecorationLine: string | undefined;
  let textDecorationStyle: string | undefined;
  let textDecorationColor: string | undefined;

  const children = node.value.children.toArray();

  let collectingDecorationLines = true;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const nextChild = children[i + 1];

    if (collectingDecorationLines) {
      if (child.type === "Identifier") {
        switch (child.name) {
          case "none":
          case "blink":
          case "inherit":
          case "initial":
          case "revert":
          case "revert-layer":
          case "unset":
          case "overline":
            textDecorationLine = "";
            continue;
          case "double":
          case "dashed":
            textDecorationLine = child.name;
            continue;
          case "line-through": {
            textDecorationLine = child.name;
            if (
              nextChild.type === "Identifier" &&
              nextChild.name === "underline"
            ) {
              i++;
              textDecorationLine = "underline line-through";
            }
            continue;
          }
          case "underline": {
            textDecorationLine = child.name;
            if (
              nextChild.type === "Identifier" &&
              nextChild.name === "line-through"
            ) {
              i++;
              textDecorationLine = "underline line-through";
            }
            continue;
          }
          default: {
            collectingDecorationLines = false;
          }
        }
      }
    }

    if (textDecorationStyle === undefined) {
      if (child.type === "Identifier") {
        switch (child.name) {
          case "wavy":
          case "inherit":
          case "initial":
          case "revert":
          case "revert-layer":
          case "unset":
            textDecorationStyle = "";
            continue;
          case "solid":
          case "double":
          case "dotted":
          case "dashed":
            textDecorationStyle = child.name;
            continue;
        }
      }
    }

    if (textDecorationColor === undefined) {
      if (child.type === "Identifier") {
        textDecorationColor = child.name;
      }
    }
  }

  if (textDecorationStyle) {
    pushStyle(atom, "textDecorationStyle", textDecorationStyle);
  }
  if (textDecorationLine) {
    pushStyle(atom, "textDecorationLine", textDecorationLine);
  }
  if (textDecorationColor) {
    pushStyle(atom, "textDecorationColor", textDecorationColor);
  }
}

function textDecorationLine(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  const children = node.value.children.toArray();

  let textDecorationLine: string | undefined;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const nextChild = children[i + 1];

    if (child.type === "Identifier") {
      switch (child.name) {
        case "none":
        case "blink":
        case "inherit":
        case "initial":
        case "revert":
        case "revert-layer":
        case "unset":
        case "overline":
          break;
        case "double":
        case "dashed":
          textDecorationLine = child.name;
          break;
        case "line-through": {
          textDecorationLine = child.name;
          if (
            nextChild.type === "Identifier" &&
            nextChild.name === "underline"
          ) {
            i++;
            textDecorationLine = "underline line-through";
          }
          break;
        }
        case "underline": {
          textDecorationLine = child.name;
          if (
            nextChild.type === "Identifier" &&
            nextChild.name === "line-through"
          ) {
            i++;
            textDecorationLine = "underline line-through";
          }

          break;
        }
      }
    }
  }

  if (textDecorationLine) {
    pushStyle(atom, "textDecorationLine", textDecorationLine);
  }
}

function textShadow(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  let children = node.value.children.toArray();

  const operatorIndex = children.findIndex(
    (child) => child.type === "Operator"
  );

  if (operatorIndex > 0) {
    children = children.slice(operatorIndex);
  }

  const firstChild = children[0];

  /* Keyword values */
  if (children.length === 1) {
    return;
  }

  /* offset-x | offset-y */
  if (children.length === 2) {
    pushStyle(atom, "textShadowOffset.width", children[0]);
    pushStyle(atom, "textShadowOffset.height", children[1]);
    return;
  }

  if (children.length === 3) {
    if (firstChild.type === "Dimension") {
      /* offset-x | offset-y | color */
      pushStyle(atom, "textShadowOffset.width", children[0]);
      pushStyle(atom, "textShadowOffset.height", children[1]);
      pushStyle(atom, "textShadowColor", children[2]);
    } else {
      /* color | offset-x | offset-y */
      pushStyle(atom, "textShadowColor", children[0]);
      pushStyle(atom, "textShadowOffset.width", children[1]);
      pushStyle(atom, "textShadowOffset.height", children[2]);
    }
    return;
  }

  if (children.length === 4) {
    if (firstChild.type === "Dimension") {
      /* offset-x | offset-y | blur-radius | color */
      pushStyle(atom, "textShadowOffset.width", children[0]);
      pushStyle(atom, "textShadowOffset.height", children[1]);
      pushStyle(atom, "textShadowRadius", children[2]);
      pushStyle(atom, "textShadowColor", children[3]);
    } else {
      /* color | offset-x | offset-y | blur-radius */
      pushStyle(atom, "textShadowColor", children[0]);
      pushStyle(atom, "textShadowOffset.width", children[1]);
      pushStyle(atom, "textShadowOffset.height", children[2]);
      pushStyle(atom, "textShadowRadius", children[3]);
    }
    return;
  }
}

function transform(atom: StylesAndTopics, node: Declaration) {
  if (node.value.type !== "Value") {
    return;
  }

  const children = node.value.children.toArray();

  if (children.length === 1 && children[0].type !== "Function") {
    return;
  }

  const transform: TransformsStyle["transform"] = [];

  for (const child of children) {
    if (child.type !== "Function") return;

    switch (child.name) {
      case "rotate":
      case "rotateX":
      case "rotateY":
      case "rotateZ":
      case "skewX":
      case "skewY":
      case "perspective":
      case "scale":
      case "scaleX":
      case "scaleY":
      case "translateX":
      case "translateY":
      case "matrix": {
        const value = parseStyleValue(child.children.toArray()[0], []);
        transform.push({ [child.name]: value } as unknown as Transform);
      }
    }
  }

  pushStyle(atom, "transform", transform);
}