import {BAKED_URL, ASSETS_URL} from '../settings'
import * as React from 'react'
import moment = require('moment');

export const CitationMeta = (props: { title: string, authors: string[], date: Date }) => {
    let {title, authors, date} = props

    if (authors.indexOf("Max Roser") === -1)
        authors = authors.concat(["Max Roser"])

    return <React.Fragment>
        <meta name="citation_title" content={title}/>
        {authors.map(author => <meta name="citation_author" content={author} key={author}/>)}
        <meta name="citation_publication_date" content={moment(date).format("YYYY/MM/DD")}/>
        <meta name="citation_journal_title" content="Our World in Data"/>
    </React.Fragment>
}
