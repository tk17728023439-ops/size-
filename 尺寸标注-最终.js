/**
 * name: 尺寸标注精简版
 * description: 简化版尺寸标注，支持高度标注、单位转换、图层重命名和自动分组
 * version: 1.4.2 (修复坐标0错误与重叠线条)
 */

'use strict';

const { app } = require('/application.js');
const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { AddChildNodesCommandBuilder } = require('/commands.js');
const { UnitValueConverter, UnitType } = require('/units.js');
const { Colour } = require('/colours.js');
const { FillDescriptor, SolidFill } = require('/fills.js');
const { LineStyleDescriptor, LineStyle, StrokeAlignment } = require('/linestyle.js');
const { Curve, PolyCurve, Point } = require('/geometry.js');
const { ContainerNodeDefinition, PolyCurveNodeDefinition, ArtTextNodeDefinition } = require('/nodes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAttDoubleType } = require('/glyphatts.js');

const ARROW_SIZE = 12;
const DEFAULT_LINE_WIDTH = 2.0;
const DEFAULT_FONT_SIZE = 16;

function formatDimension(value, unitId, factor) {
    const converted = value * factor;
    if (unitId === 'cm') {
        return converted.toFixed(2) + 'cm';
    } else if (unitId === 'mm') {
        return converted.toFixed(1) + 'mm';
    } else if (unitId === 'in') {
        return converted.toFixed(2) + 'in';
    } else if (unitId === 'ft') {
        return converted.toFixed(2) + 'ft';
    }
    return converted.toFixed(1) + 'mm';
}

function formatLayerName(width, height, unitId, isEnglish) {
    if (isEnglish) {
        return `W${width}xH${height} ${unitId}`;
    } else {
        return `宽${width}x高${height} ${unitId}`;
    }
}

function createArrowLine(startX, startY, endX, endY, lineWidth, docDpi) {
    const black = Colour.createRGBA8(0, 0, 0, 255);
    const penFill = FillDescriptor.createSolid(SolidFill.create(black));
    const noFill = FillDescriptor.createNone();
    
    const dpiScale = docDpi / 72;
    const adjustedWeight = lineWidth * dpiScale;
    
    const lineStyle = LineStyle.createDefaultWithWeight(adjustedWeight);
    const lsd = LineStyleDescriptor.create(lineStyle, {
        strokeAlignment: StrokeAlignment.Centre
    });

    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1) return null;
    
    const nx = dx / length;
    const ny = dy / length;
    
    const perpX = -ny;
    const perpY = nx;
    const arrowBaseX = endX - nx * ARROW_SIZE;
    const arrowBaseY = endY - ny * ARROW_SIZE;
    const leftX = arrowBaseX + perpX * ARROW_SIZE * 0.6;
    const leftY = arrowBaseY + perpY * ARROW_SIZE * 0.6;
    const rightX = arrowBaseX - perpX * ARROW_SIZE * 0.6;
    const rightY = arrowBaseY - perpY * ARROW_SIZE * 0.6;

    const arrowCurve1 = Curve.createLineXY(leftX, leftY, endX, endY);
    const arrowCurve2 = Curve.createLineXY(endX, endY, rightX, rightY);

    const pc = PolyCurve.create();
    // 修复点：移除了绘制冗余主线的 mainCurve，只保留箭头两条边
    pc.addCurve(arrowCurve1);
    pc.addCurve(arrowCurve2);

    return PolyCurveNodeDefinition.create(pc, noFill, lsd, penFill, noFill);
}

function createDimensionLine(x1, y1, x2, y2, lineWidth, docDpi) {
    const black = Colour.createRGBA8(0, 0, 0, 255);
    const penFill = FillDescriptor.createSolid(SolidFill.create(black));
    const noFill = FillDescriptor.createNone();
    
    const dpiScale = docDpi / 72;
    const adjustedWeight = lineWidth * dpiScale;
    
    const lineStyle = LineStyle.createDefaultWithWeight(adjustedWeight);
    const lsd = LineStyleDescriptor.create(lineStyle, {
        strokeAlignment: StrokeAlignment.Centre
    });

    const curve = Curve.createLineXY(x1, y1, x2, y2);
    const pc = PolyCurve.create();
    pc.addCurve(curve);

    return PolyCurveNodeDefinition.create(pc, noFill, lsd, penFill, noFill);
}

function createArtTextSimple(doc, x, y, text, fontSize) {
    try {
        const sb = StoryBuilder.create();
        sb.setToArtisticTextDefaultStyle(doc.dpi, 0);
        sb.addText(text);
        
        const glyphAtts = sb.glyphAtts;
        glyphAtts.setDoubleValue(GlyphAttDoubleType.Size, fontSize);
        sb.setGlyphAtts(glyphAtts);
        
        const position = new Point(x, y);
        const textDef = ArtTextNodeDefinition.createFromStoryBuilder(position, sb);
        textDef.x = x;
        textDef.y = y;
        
        return textDef;
    } catch (e) {
        console.log('创建文本失败:', e.message);
        return null;
    }
}

function main() {
    try {
        const doc = Document.current;
        if (!doc) {
            app.alert('请先打开一个文档', '尺寸标注精简版');
            return;
        }

        const selection = doc.selection;
        if (selection.length === 0) {
            app.alert('请至少选择一个对象', '尺寸标注精简版');
            return;
        }

        // 创建配置对话框
        const dlg = Dialog.create('尺寸标注精简版');
        dlg.initialWidth = 360;
        
        const col = dlg.addColumn();

        const unitGrp = col.addGroup('单位');
        const unitCombo = unitGrp.addComboBox('', ['毫米 (mm)', '厘米 (cm)', '英寸 (in)', '英尺 (ft)'], 1);

        const langGrp = col.addGroup('语言');
        const langCombo = langGrp.addComboBox('', ['中文', 'English'], 0);

        const fontSizeGrp = col.addGroup('字体大小 (pt)');
        const fontSizeEdit = fontSizeGrp.addTextBox('', DEFAULT_FONT_SIZE.toString());

        const lineWidthGrp = col.addGroup('线条宽度 (pt)');
        const lineWidthEdit = lineWidthGrp.addTextBox('', DEFAULT_LINE_WIDTH.toString());

        const offsetGrp = col.addGroup('标注偏移 (px)');
        const offsetEdit = offsetGrp.addTextBox('', '50');

        const optionsGrp = col.addGroup('选项');
        const renameChk = optionsGrp.addCheckBox('重命名图层为尺寸', true);
        const groupChk = optionsGrp.addCheckBox('将标注元素分组', true);

        const btnGrp = col.addGroup('');
        const btns = btnGrp.addButtonSet('', ['应用', '取消'], 0);
        btns.isFullWidth = true;

        const result = dlg.show();
        if (result.value !== DialogResult.Ok.value) {
            return;
        }

        const unitIndex = unitCombo.selectedIndex;
        let unitId, unitFactor, unitType;
        switch (unitIndex) {
            case 0: // mm
                unitId = 'mm';
                unitFactor = 1;
                unitType = UnitType.Millimetre;
                break;
            case 1: // cm
                unitId = 'cm';
                unitFactor = 0.1;
                unitType = UnitType.Millimetre;
                break;
            case 2: // in
                unitId = 'in';
                unitFactor = 1;
                unitType = UnitType.Inch;
                break;
            case 3: // ft
                unitId = 'ft';
                unitFactor = 1;
                unitType = UnitType.Foot;
                break;
            default:
                unitId = 'cm';
                unitFactor = 0.1;
                unitType = UnitType.Millimetre;
        }
        
        const langIndex = langCombo.selectedIndex;
        const isEnglish = langIndex === 1;
        
        const fontSize = parseFloat(fontSizeEdit.text) || DEFAULT_FONT_SIZE;
        const lineWidth = parseFloat(lineWidthEdit.text) || DEFAULT_LINE_WIDTH;
        const offset = parseFloat(offsetEdit.text) || 50;
        const renameLayers = renameChk.value;
        const groupElements = groupChk.value;
        const docDpi = doc.dpi;

        // 单位转换
        const converter = UnitValueConverter.create(docDpi);
        const pxToUnit = converter.getConversionFactor(UnitType.Pixel, unitType);

        let processedCount = 0;

        // 遍历每个选中的对象
        for (let i = 0; i < selection.length; i++) {
            const item = selection.at(i);
            if (!item || !item.node) continue;
            
            const node = item.node;
            try {
                const bb = node.getExactSpreadBaseBox();
                
                // 修复点：严谨判断 undefined，避免坐标刚好为0时误判跳过
                if (!bb || typeof bb.x === 'undefined' || typeof bb.y === 'undefined' || typeof bb.width === 'undefined' || typeof bb.height === 'undefined') {
                    continue;
                }

                const x = bb.x;
                const y = bb.y;
                const width = Math.abs(bb.width);
                const height = Math.abs(bb.height);

                if (width <= 0 || height <= 0) continue;

                // 计算尺寸值
                const widthValue = width * pxToUnit;
                const heightValue = height * pxToUnit;
                const widthText = formatDimension(widthValue, unitId, unitFactor);
                const heightText = formatDimension(heightValue, unitId, unitFactor);

                // 重命名图层
                if (renameLayers) {
                    const layerName = formatLayerName(
                        Math.round(widthValue * unitFactor),
                        Math.round(heightValue * unitFactor),
                        unitId,
                        isEnglish
                    );
                    node.userDescription = layerName;
                }

                let target = doc.currentSpread;
                
                // 创建标注组
                if (groupElements) {
                    const groupDef = ContainerNodeDefinition.createDefault();
                    const groupName = isEnglish ? `Dimensions - W${Math.round(widthValue * unitFactor)}xH${Math.round(heightValue * unitFactor)} ${unitId}` : `标注 - 宽${Math.round(widthValue * unitFactor)}x高${Math.round(heightValue * unitFactor)} ${unitId}`;
                    groupDef.userDescription = groupName;
                    
                    const groupBuilder = AddChildNodesCommandBuilder.create();
                    groupBuilder.setInsertionTarget(doc.currentSpread);
                    groupBuilder.addContainerNode(groupDef);
                    const groupCmd = groupBuilder.createCommand(false);
                    doc.executeCommand(groupCmd);
                    
                    if (groupCmd.newNodes && groupCmd.newNodes.length > 0) {
                        target = groupCmd.newNodes[0];
                    } else {
                        target = doc.currentSpread;
                    }
                }

                // 在对象上方添加标注
                const builder = AddChildNodesCommandBuilder.create();
                builder.setInsertionTarget(target);

                // ========== 宽度标注（上方）==========
                
                // 添加宽度尺寸文本
                const widthLabelX = x + width / 2;
                const widthLabelY = y - offset - fontSize;
                const widthTextDef = createArtTextSimple(doc, widthLabelX, widthLabelY, widthText, fontSize);
                if (widthTextDef) {
                    builder.addNode(widthTextDef);
                }

                // 添加宽度标注线 (主线)
                const widthLineY = y - offset;
                const widthLine = createDimensionLine(x, widthLineY, x + width, widthLineY, lineWidth, docDpi);
                if (widthLine) builder.addPolyCurveNode(widthLine);

                // 添加宽度箭头
                const arrow1 = createArrowLine(x, widthLineY, x + width, widthLineY, lineWidth, docDpi);
                const arrow2 = createArrowLine(x + width, widthLineY, x, widthLineY, lineWidth, docDpi);
                if (arrow1) builder.addPolyCurveNode(arrow1);
                if (arrow2) builder.addPolyCurveNode(arrow2);

                // ========== 高度标注（左侧）==========

                // 添加高度尺寸文本
                const heightLabelX = x - offset - fontSize;
                const heightLabelY = y + height / 2;
                const heightTextDef = createArtTextSimple(doc, heightLabelX, heightLabelY, heightText, fontSize);
                if (heightTextDef) {
                    builder.addNode(heightTextDef);
                }

                // 添加高度标注线 (主线)
                const heightLineX = x - offset;
                const heightLine = createDimensionLine(heightLineX, y, heightLineX, y + height, lineWidth, docDpi);
                if (heightLine) builder.addPolyCurveNode(heightLine);

                // 添加高度箭头
                const arrow3 = createArrowLine(heightLineX, y, heightLineX, y + height, lineWidth, docDpi);
                const arrow4 = createArrowLine(heightLineX, y + height, heightLineX, y, lineWidth, docDpi);
                if (arrow3) builder.addPolyCurveNode(arrow3);
                if (arrow4) builder.addPolyCurveNode(arrow4);

                // 执行命令
                doc.executeCommand(builder.createCommand(false));
                processedCount++;

            } catch (e) {
                console.log('处理对象时出错:', e.message);
            }
        }

        app.alert(`已处理 ${processedCount} 个对象\n单位: ${unitId}\n语言: ${isEnglish ? 'English' : '中文'}\n字体大小: ${fontSize}pt\n线条宽度: ${lineWidth}pt\n文档DPI: ${docDpi}`, '尺寸标注精简版');

    } catch (e) {
        console.log('错误:', e.message);
        app.alert('错误: ' + e.message, '尺寸标注精简版');
    }
}

main();