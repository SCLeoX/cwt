import { commands, DecorationRangeBehavior, ExtensionContext, Position, Range, TextDocument, TextEditor, window, workspace } from 'vscode';
import Segment = require('segment');
import { ConfigOverrider } from './ConfigOverrider';

function getSegmentRangeAtIndex(line: string, segments: Array<string>, index: number): null | [number, number] {
  let pointer = 0;
  for (const segment of segments) {
    const startIndex = line.indexOf(segment, pointer);
    const endIndex = startIndex + segment.length;
    if (startIndex > index) {
      return null;
    }
    if (index <= endIndex) {
      return [startIndex, endIndex];
    }
    pointer = endIndex;
  }
  return null;
}

function getRangesOfSegment(lineIndex: number, line: string, segments: Array<string>, targetSegment: string) {
  let pointer = 0;
  const results: Array<Range> = [];
  for (const segment of segments) {
    pointer = line.indexOf(segment, pointer);
    if (segment === targetSegment) {
      results.push(new Range(
        new Position(lineIndex, pointer),
        new Position(lineIndex, pointer + segment.length),
      ));
    }
    pointer += segment.length;
  }
  return results;
}

const editorOccurrencesHighlightOverrider = new ConfigOverrider<boolean>(
  'editor.occurrencesHighlight',
  'cwt.repetitionDetection.override.editorOccurrencesHighlight.enabled',
  'cwt.repetitionDetection.override.editorOccurrencesHighlight.originalValue',
).register();

const editorSemanticHighlightingEnabledOverrider = new ConfigOverrider<boolean>(
  'editor.semanticHighlighting.enabled',
  'cwt.repetitionDetection.override.editorSemanticHighlightingEnabled.enabled',
  'cwt.repetitionDetection.override.editorSemanticHighlightingEnabled.originalValue',
).register();

const editorSelectionHighlightOverrider = new ConfigOverrider<boolean>(
  'editor.selectionHighlight',
  'cwt.repetitionDetection.override.editorSelectionHighlight.enabled',
  'cwt.repetitionDetection.override.editorSelectionHighlight.originalValue',
).register();

function disableHighlight() {
  editorOccurrencesHighlightOverrider.override(false);
  editorSemanticHighlightingEnabledOverrider.override(false);
  editorSelectionHighlightOverrider.override(false);
}

function restoreHighlight() {
  editorOccurrencesHighlightOverrider.restore();
  editorSemanticHighlightingEnabledOverrider.restore();
  editorSelectionHighlightOverrider.restore();
}

export function repetitionDetection(context: ExtensionContext) {
  const config = workspace.getConfiguration('cwt.repetitionDetection');
  let segment: any = null;
  // Delay segment initialization as much as possible
  function getSegment() {
    if (segment === null) {
      segment = new Segment().useDefault();
    }
    return segment;
  }
  const enabledDocuments = new WeakSet<TextDocument>();
  const detectorMap = new WeakMap<TextEditor, RepetitionDetector>();
  const closeDecoration = window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.6)',
    rangeBehavior: DecorationRangeBehavior.ClosedClosed
  });
  const farDecoration = window.createTextEditorDecorationType({
    backgroundColor: 'rgba(0,255,0,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    rangeBehavior: DecorationRangeBehavior.ClosedClosed
  });
  function enableRepetitionDetection(editor: TextEditor) {
    enabledDocuments.add(editor.document);
    window.visibleTextEditors.forEach(visibleEditor => {
      if (visibleEditor.document === editor.document) {
        detectorMap.set(visibleEditor, new RepetitionDetector(visibleEditor, getSegment()));
      }
    });
    disableHighlight();
  }
  function disableRepetitionDetection(editor: TextEditor) {
    enabledDocuments.delete(editor.document);
    window.visibleTextEditors.forEach(visibleEditor => {
      if (visibleEditor.document === editor.document) {
        detectorMap.get(visibleEditor)?.stop();
        detectorMap.delete(visibleEditor);
      }
    });
    restoreHighlight();
  }
  context.subscriptions.push(
    closeDecoration,
    farDecoration,
    commands.registerCommand('cwt.startRepetitionDetection', () => {
      const editor = window.activeTextEditor;
      if (editor === undefined) {
        window.showErrorMessage("请打开一个文档再使用本命令。");
        return;
      }
      if (enabledDocuments.has(editor.document)) {
        window.showErrorMessage("重复检测已经在此文档启用了。");
        return;
      }
      enableRepetitionDetection(editor);
    }),
    commands.registerCommand('cwt.stopRepetitionDetection', () => {
      const editor = window.activeTextEditor;
      if (editor === undefined) {
        window.showErrorMessage("请打开一个文档再使用本命令。");
        return;
      }
      if (!enabledDocuments.has(editor.document)) {
        window.showErrorMessage("重复检测已经在此文档禁用了。");
        return;
      }
      disableRepetitionDetection(editor);
    }),
    commands.registerCommand('cwt.toggleRepetitionDetection', () => {
      const editor = window.activeTextEditor;
      if (editor === undefined) {
        window.showErrorMessage("请打开一个文档再使用本命令。");
        return;
      }
      if (enabledDocuments.has(editor.document)) {
        disableRepetitionDetection(editor);
      } else {
        enableRepetitionDetection(editor);
      }
    }),
    window.onDidChangeTextEditorSelection(event => {
      const detector = detectorMap.get(event.textEditor);
      if (detector !== undefined) {
        detector.onSelectionChange();
      }
    }),
    window.onDidChangeVisibleTextEditors(event => {
      event.forEach(editor => {
        if (detectorMap.has(editor)) {
          return;
        }
        if (enabledDocuments.has(editor.document)) {
          detectorMap.set(editor, new RepetitionDetector(editor, getSegment()));
        }
      });
    }),
    workspace.onDidChangeTextDocument(event => {
      if (window.activeTextEditor === undefined || window.activeTextEditor.document !== event.document) {
        return;
      }
      const detector = detectorMap.get(window.activeTextEditor);
      if (detector !== undefined) {
        detector.onEdit();
      }
    }),
    window.onDidChangeActiveTextEditor(editor => {
      if (editor === undefined || !enabledDocuments.has(editor.document)) {
        restoreHighlight();
      } else {
        disableHighlight();
      }
    }),
  );

  class RepetitionDetector {
    private editor: TextEditor;
    private segment: any;
    private segmentationCache = new Map<string, Array<string>>();
    private lastCloseRepetitionInitPosition: Position | null = null;
    private lastCloseRepetitionSegment: string | null = null;
    public constructor(editor: TextEditor, segment: any) {
      this.editor = editor;
      this.segment = segment;
      this.onSelectionChange();
    }
    private doSegment(line: string): Array<string> {
      let cachedValue: any = this.segmentationCache.get(line);
      if (cachedValue === undefined) {
        cachedValue = this.segment.doSegment(line, {
          simple: true,
          stripPunctuation: true
        });
        this.segmentationCache.set(line, cachedValue);
      }
      return cachedValue;
    }
    public stop() {
      this.editor.setDecorations(closeDecoration, []);
      this.editor.setDecorations(farDecoration, []);
    }

    /**
     * Remove all far repetition decorations and only remove close repetition if
     * keepLastCloseRepetition is set to false.
     */
    private resetDecorations() {
      if (!config.get<boolean>('keepLastCloseRepetition')) {
        this.editor.setDecorations(closeDecoration, []);
        this.lastCloseRepetitionInitPosition = null;
        this.lastCloseRepetitionSegment = null;
      }
      this.editor.setDecorations(farDecoration, []);
    }
    public onEdit() {
      if (this.lastCloseRepetitionInitPosition !== null) {
        this.editor.setDecorations(closeDecoration, []);
        this.runDetectionAt(this.lastCloseRepetitionInitPosition, this.lastCloseRepetitionSegment);
      }
      this.onSelectionChange();
    } 
    public onSelectionChange() {
      const selections = this.editor.selections;
      if (selections.length !== 1) {
        return;
      }
      this.runDetectionAt(selections[0].active, null);
    }

    /**
     * @param targetPosition Position to run repetition detection
     * @param assertSegment If provided, only run detection if the segment at
     * the given position matches the provided value.
     */
    public runDetectionAt(targetPosition: Position, assertSegment: string | null) {
      const document = this.editor.document;
      const targetLineIndex = targetPosition.line;
      const targetColumnIndex = targetPosition.character;
      const targetLine = document.getText(new Range(
        new Position(targetLineIndex, 0),
        new Position(targetLineIndex + 1, 0),
      ));
      if (targetLine === '') {
        this.resetDecorations();
        return;
      }
      const segments: Array<string> = this.doSegment(targetLine);
      const targetSegmentColumnRange = getSegmentRangeAtIndex(targetLine, segments, targetColumnIndex);
      if (targetSegmentColumnRange === null) {
        this.resetDecorations();
        return;
      }
      /** Segment under target */
      const targetSegment = targetLine.substring(targetSegmentColumnRange[0], targetSegmentColumnRange[1]);
      if (targetSegment.length === 1 && config.get<boolean>('ignoreOneCharSegments')!) {
        this.resetDecorations();
        return;
      }
      if (config.get<Array<string>>('ignoreList')!.includes(targetSegment)) {
        this.resetDecorations();
        return;
      }
      if (assertSegment !== null && targetSegment !== assertSegment) {
        this.resetDecorations();
        return;
      }
      const closeRepetitions: Array<Range> = [];
      const farRepetitions: Array<Range> = [];
      let hasCloseRepetition = false;
      document.getText().split('\n').forEach((line, lineIndex) => {
        const lineSegments: Array<string> = this.doSegment(line);
        getRangesOfSegment(lineIndex, line, lineSegments, targetSegment).forEach(range => {
          if (range.contains(targetPosition)) {
            return;
          }
          if (Math.abs(range.start.line - targetLineIndex) <= config.get<number>('closeRepetitionLineDifference')!) {
            closeRepetitions.push(range);
            hasCloseRepetition = true;
          } else {
            farRepetitions.push(range);
          }
        });
      });
      const targetSegmentRange = new Range(
        new Position(targetLineIndex, targetSegmentColumnRange[0]),
        new Position(targetLineIndex, targetSegmentColumnRange[1]),
      );
      (hasCloseRepetition ? closeRepetitions : farRepetitions).push(targetSegmentRange);
      if (hasCloseRepetition || !config.get<boolean>('keepLastCloseRepetition')) {
        this.lastCloseRepetitionInitPosition = targetPosition;
        this.lastCloseRepetitionSegment = targetSegment;
        this.editor.setDecorations(closeDecoration, closeRepetitions);
      }
      this.editor.setDecorations(farDecoration, farRepetitions);
    }
  }
}
