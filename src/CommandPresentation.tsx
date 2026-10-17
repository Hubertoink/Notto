import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createLibrary, Renderer } from '@openuidev/react-lang';
import {
  answerComponent,
  presentationComponents,
  readPresentation,
  storePresentation,
} from './command-presentation';
import { commandResultMarkdown, itemTaskText } from './command-result-text';
import type { CommandResult } from './note-command';
import './command-presentation.css';

interface Props {
  result: CommandResult;
  fallback: ReactNode;
  renderItem: (index: number, layout?: 'card' | 'comparison') => ReactNode;
  onInsert?: (text: string) => void;
}
const ResultContext = createContext<Pick<Props, 'result' | 'renderItem' | 'onInsert'> | null>(null);

function Section({ type, items }: { type: string; items: number[] }) {
  const { result, renderItem, onInsert } = useContext(ResultContext)!;
  if (type === 'Comparison')
    return (
      <section className="answer-comparison">
        <h3>Vergleich</h3>
        <div className="answer-table-scroll" role="region" aria-label="Vergleichstabelle" tabIndex={0}>
          <table>
            <caption>Vergleich der Ergebnisse mit Quellen</caption>
            <thead>
              <tr>
                <th scope="col">Aspekt</th>
                <th scope="col">Ergebnis & Belege</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i}>
                  <th scope="row">{result.items[i].title}</th>
                  <td>{renderItem(i, 'comparison')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  if (type === 'Plan')
    return (
      <section className="answer-plan">
        <h3>Ablaufplan</h3>
        <ol>
          {items.map((i, step) => (
            <li key={i}>
              <span className="answer-step" aria-hidden="true">
                {step + 1}
              </span>
              <div>
                {renderItem(i)}
                {onInsert && (
                  <button
                    type="button"
                    className="answer-task"
                    onClick={() => onInsert(itemTaskText(result.items[i]))}
                  >
                    Als Aufgabe in Notiz übernehmen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  return (
    <section className="answer-sources">
      <h3>Kernaussagen & Quellen</h3>
      <div className="command-results">
        {items.map((i) => (
          <div key={i}>{renderItem(i)}</div>
        ))}
      </div>
    </section>
  );
}

const library = createLibrary({
  root: 'Answer',
  components: [
    {
      ...answerComponent,
      component: ({ props, renderNode }) => (
        <div className="answer-sections">{renderNode(props.sections)}</div>
      ),
    },
    ...presentationComponents.map((definition) => ({
      ...definition,
      component: ({ props }: { props: { items: number[] } }) => (
        <Section type={definition.name} items={props.items} />
      ),
    })),
  ],
});

export default function CommandPresentation({ result, fallback, renderItem, onInsert }: Props) {
  const [textOnly, setTextOnly] = useState(false);
  const [failed, setFailed] = useState(false);
  const sections = useMemo(
    () => readPresentation(result.presentation, result.items.length),
    [result.presentation, result.items.length],
  );
  if (!sections || failed) return fallback;
  // Never hand the original model program to the renderer, even after validation.
  const source = storePresentation(result.presentation?.source, result.items.length)!.source;
  return (
    <div className="command-presentation">
      <div className="answer-toolbar">
        <span>Antwortübersicht</span>
        <button type="button" aria-pressed={textOnly} onClick={() => setTextOnly(!textOnly)}>
          {textOnly ? 'Übersicht anzeigen' : 'Textansicht'}
        </button>
      </div>
      {textOnly ? (
        fallback
      ) : (
        <>
          <ResultContext.Provider value={{ result, renderItem, onInsert }}>
            <Renderer
              library={library}
              response={source}
              isStreaming={false}
              onError={(errors) => {
                if (errors.length) setFailed(true);
              }}
            />
          </ResultContext.Provider>
          {onInsert && (
            <button
              type="button"
              className="answer-insert"
              onClick={() => onInsert(commandResultMarkdown(result, sections))}
            >
              In Notiz übernehmen
            </button>
          )}
        </>
      )}
    </div>
  );
}
