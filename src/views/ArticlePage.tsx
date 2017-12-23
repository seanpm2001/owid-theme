import * as settings from '../settings'
import * as React from 'react'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { formatContent, formatAuthors } from '../formatting'
import { CategoryWithEntries } from '../wpdb'

export interface PageInfo {
    title: string
    content: string
    authors: string[]
}

export const ArticlePage = (props: { entries: CategoryWithEntries[], page: PageInfo }) => {
    const {entries, page} = props
    const {footnotes, html} = formatContent(page.content)
    const authorsText = formatAuthors(page.authors)

    return <html>
        <head>
            <link rel="stylesheet" href={`${settings.STATIC_ROOT}/owid.css`}/>
        </head>
        <body>
            <SiteHeader entries={entries}/>
            <main id="main" className="site-main">
                <div className="page-with-sidebar clearfix">
                    <div className="entry-sidebar">
                        <nav className="entry-toc">
                        </nav>
                    </div>
                    <article className="page">
                        <header className="article-header">
                            <h1 className="entry-title">{page.title}</h1>
                            <div className="authors-byline">
                                <a href="/about/#the-team">by {authorsText}</a>
                            </div>
                        </header>
                        <div className="article-content" dangerouslySetInnerHTML={{__html: html}}/>
                        <footer className="article-footer">
                            <h2 id="footnotes">Footnotes</h2>
                            <ol className="side-matter side-matter-list" style={{'list-style-type': 'decimal', opacity: 1}}>
                                {footnotes.map((footnote, i) =>
                                    <li id={`note-${i+1}`} className="side-matter side-matter-note" style={{'margin-top': '0px'}}>
                                        <div className="side-matter side-matter-text">
                                            <p dangerouslySetInnerHTML={{__html: footnote}}/>
                                        </div>
                                    </li>
                                )}
                            </ol>
                        </footer>
                    </article>
                </div>
            </main>
            <SiteFooter/>
        </body>
    </html>
}